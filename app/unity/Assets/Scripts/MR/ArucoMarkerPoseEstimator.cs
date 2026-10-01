using System;
using System.Collections.Generic;
using OpenCVForUnity.CoreModule;
using OpenCVForUnity.GeometryModule;
using UnityEngine;

public sealed class ArucoMarkerPoseEstimate
{
    public bool IsValid { get; }
    public string RejectionReason { get; }
    public Pose CameraPose { get; }
    public Vector3 CameraPositionMeters => CameraPose.position;
    public Quaternion CameraRotation => CameraPose.rotation;
    public double ReprojectionErrorPixels { get; }
    public double AlternativeReprojectionErrorPixels { get; }
    public int CandidateCount { get; }

    public ArucoMarkerPoseEstimate(bool valid, string reason, Pose pose, double error, double alternativeError, int candidates)
    {
        IsValid = valid;
        RejectionReason = reason;
        CameraPose = pose;
        ReprojectionErrorPixels = error;
        AlternativeReprojectionErrorPixels = alternativeError;
        CandidateCount = candidates;
    }
}

public sealed class ArucoMarkerPoseEstimator
{
    public const double MarkerSizeMeters = 0.2;
    public const int TargetMarkerId = 0;

    public ArucoMarkerPoseEstimate Estimate(float[] cornersPixels, int cornerOffset, double fx, double fy, double cx, double cy)
    {
        if (!Finite(fx) || !Finite(fy) || !Finite(cx) || !Finite(cy) || fx <= 0 || fy <= 0)
            return Rejected("invalid intrinsics");
        if (cornersPixels == null || cornerOffset < 0 || cornerOffset > cornersPixels.Length - 8)
            return Rejected("invalid corners");

        var points = new Point[4];
        for (int i = 0; i < 4; i++)
        {
            double x = cornersPixels[cornerOffset + i * 2];
            double y = cornersPixels[cornerOffset + i * 2 + 1];
            if (!Finite(x) || !Finite(y)) return Rejected("invalid corners");
            points[i] = new Point(x, y);
        }
        for (int i = 0; i < 4; i++)
        {
            var a = points[i];
            var b = points[(i + 1) % 4];
            var c = points[(i + 2) % 4];
            if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1)
                return Rejected("invalid corners");
        }

        const double half = MarkerSizeMeters / 2;
        var solverPoints = new Point[4];
        double edgeAngle = Math.Atan2(-(points[1].y - points[0].y) / fy, (points[1].x - points[0].x) / fx);
        double cosine = Math.Cos(edgeAngle);
        double sine = Math.Sin(edgeAngle);
        // Reflect camera Y and marker Z, then align the top edge in the solver camera.
        // This avoids IPPE's Rodrigues singularity at front-facing 180-degree rotations.
        for (int i = 0; i < 4; i++)
        {
            double x = (points[i].x - cx) / fx;
            double y = -(points[i].y - cy) / fy;
            solverPoints[i] = new Point(fx * (cosine * x + sine * y) + cx, fy * (-sine * x + cosine * y) + cy);
        }
        var rotations = new List<Mat>();
        var translations = new List<Mat>();
        try
        {
            using (var objects = new MatOfPoint3f(new Point3(-half, half, 0), new Point3(half, half, 0), new Point3(half, -half, 0), new Point3(-half, -half, 0)))
            using (var pixels = new MatOfPoint2f(solverPoints))
            using (var camera = new Mat(3, 3, CvType.CV_64FC1))
            using (var distortion = new MatOfDouble())
            {
                camera.put(0, 0, new double[] { fx, 0, cx, 0, fy, cy, 0, 0, 1 });
                int count = Geometry.solvePnPGeneric(objects, pixels, camera, distortion, rotations, translations, false, Geometry.SOLVEPNP_IPPE_SQUARE);
                var candidates = new List<Candidate>();
                for (int i = 0; i < Math.Min(rotations.Count, translations.Count); i++)
                {
                    var candidate = ReadCandidate(objects.toArray(), points, fx, fy, cx, cy, rotations[i], translations[i], cosine, sine);
                    if (candidate != null) candidates.Add(candidate);
                }
                if (candidates.Count == 0) return Rejected("no positive-depth pose", count);
                candidates.Sort((a, b) => a.Error.CompareTo(b.Error));
                var best = candidates[0];
                double alternative = candidates.Count > 1 ? candidates[1].Error : double.PositiveInfinity;
                string rejection = best.Error > 3 ? "excessive reprojection error" : null;
                if (rejection == null && candidates.Count > 1 && alternative - best.Error <= 0.25 &&
                    (Quaternion.Angle(best.Pose.rotation, candidates[1].Pose.rotation) > 10 ||
                     Vector3.Distance(best.Pose.position, candidates[1].Pose.position) > 0.02f))
                    rejection = "ambiguous pose";
                return new ArucoMarkerPoseEstimate(rejection == null, rejection, best.Pose, best.Error, alternative, count);
            }
        }
        catch (CvException)
        {
            return Rejected("pose solver failed");
        }
        finally
        {
            foreach (var rotation in rotations) rotation.Dispose();
            foreach (var translation in translations) translation.Dispose();
        }
    }

    private static Candidate ReadCandidate(Point3[] objects, Point[] measured, double fx, double fy, double cx, double cy, Mat rvec, Mat tvec, double cosine, double sine)
    {
        using (var rotation = new Mat())
        {
            Geometry.Rodrigues(rvec, rotation);
            var r = new double[9];
            var t = new double[3];
            rotation.get(0, 0, r);
            tvec.get(0, 0, t);
            // Undo the solver basis before testing depth and reprojection in the captured camera.
            for (int column = 0; column < 3; column++)
            {
                double x = r[column];
                double y = r[3 + column];
                r[column] = cosine * x - sine * y;
                r[3 + column] = sine * x + cosine * y;
            }
            double tx = t[0];
            double ty = t[1];
            t[0] = cosine * tx - sine * ty;
            t[1] = sine * tx + cosine * ty;
            r[2] = -r[2];
            r[3] = -r[3];
            r[4] = -r[4];
            r[8] = -r[8];
            t[1] = -t[1];
            foreach (double value in r) if (!Finite(value)) return null;
            foreach (double value in t) if (!Finite(value)) return null;
            double squaredError = 0;
            for (int i = 0; i < 4; i++)
            {
                var point = objects[i];
                double x = r[0] * point.x + r[1] * point.y + t[0];
                double y = r[3] * point.x + r[4] * point.y + t[1];
                double z = r[6] * point.x + r[7] * point.y + t[2];
                if (z <= 0) return null;
                double dx = fx * x / z + cx - measured[i].x;
                double dy = fy * y / z + cy - measured[i].y;
                squaredError += dx * dx + dy * dy;
            }
            double error = Math.Sqrt(squaredError / 4);
            if (!Finite(error)) return null;

            // Reflect camera Y and marker Z so Unity's marker +Z points into the paper.
            var forward = new Vector3((float)-r[2], (float)r[5], (float)-r[8]);
            var up = new Vector3((float)r[1], (float)-r[4], (float)r[7]);
            var pose = new Pose(new Vector3((float)t[0], (float)-t[1], (float)t[2]), Quaternion.LookRotation(forward, up));
            return new Candidate(pose, error);
        }
    }

    private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    private static ArucoMarkerPoseEstimate Rejected(string reason, int candidates = 0) =>
        new ArucoMarkerPoseEstimate(false, reason, new Pose(Vector3.zero, Quaternion.identity), double.NaN, double.NaN, candidates);

    private sealed class Candidate
    {
        public Pose Pose { get; }
        public double Error { get; }
        public Candidate(Pose pose, double error)
        {
            Pose = pose;
            Error = error;
        }
    }
}

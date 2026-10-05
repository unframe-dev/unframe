package runtimecore

import (
	"encoding/json"
	realtimev2 "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/realtime"
	"math"
)

func applyV2TimelineAt(snapshot *realtimev2.CanonicalRuntimeSnapshot, timeline v2Timeline, elapsed uint64) error {
	for i, track := range timeline.Tracks {
		if len(track.Keyframes) == 0 {
			return ErrV2RuntimeDefinition
		}
		value := track.Keyframes[len(track.Keyframes)-1].Value
		if elapsed == 0 {
			value = track.Keyframes[0].Value
		} else if elapsed < timeline.DurationMilliseconds {
			value = track.Keyframes[0].Value
			for j := 1; j < len(track.Keyframes); j++ {
				to, from := track.Keyframes[j], track.Keyframes[j-1]
				if elapsed >= to.TimeMilliseconds {
					continue
				}
				u := float64(elapsed-from.TimeMilliseconds) / float64(to.TimeMilliseconds-from.TimeMilliseconds)
				switch from.EasingToNext {
				case "linear":
				case "cubicIn":
					u = u * u * u
				case "cubicOut":
					v := 1 - u
					u = 1 - v*v*v
				case "cubicInOut":
					if u < 0.5 {
						u = 4 * u * u * u
					} else {
						v := -2*u + 2
						u = 1 - v*v*v/2
					}
				default:
					return ErrV2RuntimeDefinition
				}
				if track.Target.Property == "opacity" {
					var a, b float64
					if json.Unmarshal(from.Value, &a) != nil || json.Unmarshal(to.Value, &b) != nil {
						return ErrV2RuntimeDefinition
					}
					value, _ = json.Marshal(a + (b-a)*u)
				} else {
					var a, b []float64
					if json.Unmarshal(from.Value, &a) != nil || json.Unmarshal(to.Value, &b) != nil || len(a) != len(b) {
						return ErrV2RuntimeDefinition
					}
					if track.Target.Property == "transform.rotation" {
						if len(a) != 4 {
							return ErrV2RuntimeDefinition
						}
						normalize := func(v []float64) bool {
							n := 0.0
							for _, x := range v {
								n += x * x
							}
							n = math.Sqrt(n)
							if n == 0 || math.IsInf(n, 0) {
								return false
							}
							for k := range v {
								v[k] /= n
							}
							return true
						}
						if !normalize(a) || !normalize(b) {
							return ErrV2RuntimeDefinition
						}
						dot := 0.0
						for k := range a {
							dot += a[k] * b[k]
						}
						if dot < 0 {
							for k := range b {
								b[k] = -b[k]
							}
							dot = -dot
						}
						wa, wb := 1-u, u
						if dot <= 0.9995 {
							theta := math.Acos(math.Min(1, dot))
							wa = math.Sin((1-u)*theta) / math.Sin(theta)
							wb = math.Sin(u*theta) / math.Sin(theta)
						}
						for k := range a {
							a[k] = wa*a[k] + wb*b[k]
						}
						if !normalize(a) {
							return ErrV2RuntimeDefinition
						}
						sign := 1.0
						for _, k := range []int{3, 0, 1, 2} {
							if a[k] != 0 {
								if a[k] < 0 {
									sign = -1
								}
								break
							}
						}
						for k := range a {
							a[k] *= sign
							if a[k] == 0 {
								a[k] = 0
							}
						}
					} else {
						if len(a) != 3 {
							return ErrV2RuntimeDefinition
						}
						for k := range a {
							a[k] += (b[k] - a[k]) * u
						}
					}
					value, _ = json.Marshal(a)
				}
				break
			}
		}
		timeline.Tracks[i].Keyframes[len(track.Keyframes)-1].Value = value
	}
	return applyV2TimelineFinal(snapshot, timeline)
}

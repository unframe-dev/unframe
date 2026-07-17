using System.Collections.Generic;
using UnityEngine;

public class BuiltPresentation
{
    public string presentationId;
    public string title;
    public GameObject presentationRoot;
    public bool usesCircularView;
    public ManifestCircularView circularView;
    public List<BuiltSlide> slides = new List<BuiltSlide>();
}

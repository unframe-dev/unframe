using System.Collections.Generic;
using UnityEngine;

public class BuiltSlide
{
    public string slideId;
    public int orderIndex;
    public GameObject slideRoot;
    public GameObject planeAnchor;
    public GameObject backgroundPanel;

    public List<string> elementIds = new List<string>();
    public Dictionary<string, GameObject> objectsByElementId = new Dictionary<string, GameObject>();
}

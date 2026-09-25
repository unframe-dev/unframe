using Unframe.Delivery.V2;
using UnityEngine;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Inspector-assigned local Delivery fixture. It is not a network or production content source.
    /// </summary>
    public sealed class LocalPresentationFixtureSource : MonoBehaviour
    {
        [SerializeField] private TextAsset deliveryFixture;

        public void SetDeliveryFixture(TextAsset fixture)
        {
            deliveryFixture = fixture;
        }

        public bool TryLoadDelivery(PresentationRuntimeDataStore store, out string error)
        {
            if (store == null)
            {
                error = "A presentation data store is required.";
                return false;
            }

            if (deliveryFixture == null)
            {
                error = "A local Delivery fixture is required.";
                return false;
            }

            if (!PresentationContractJsonFixtureLoader.TryParseDelivery(deliveryFixture.text, out DeliveryManifest manifest, out error))
            {
                return false;
            }

            return store.TryReceiveDelivery(manifest, out error);
        }
    }
}

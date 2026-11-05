package protocolv2

import (
	"math"
	"strings"
	"testing"

	presentation "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/presentation"
)

func TestPlacementReferenceAllowsCanonicalCatalogWithoutPlacement(t *testing.T) {
	catalog := &presentation.ProjectedRuntimeCatalog{CatalogContractVersion: 3}
	if err := ValidateMessage(catalog); err != nil {
		t.Fatal(err)
	}
	catalog.PlacementReferencePoint = &presentation.Vector3{X: -1, Y: 2.15, Z: -2.5}
	if err := ValidateMessage(catalog); err != nil {
		t.Fatal(err)
	}
}

func TestPlacementReferenceRejectsNoncanonicalCoordinates(t *testing.T) {
	for name, value := range map[string]float64{
		"nan": math.NaN(), "positive-infinity": math.Inf(1),
		"negative-infinity": math.Inf(-1), "negative-zero": math.Copysign(0, -1),
	} {
		t.Run(name, func(t *testing.T) {
			catalog := &presentation.ProjectedRuntimeCatalog{
				CatalogContractVersion:  3,
				PlacementReferencePoint: &presentation.Vector3{Y: value},
			}
			if err := ValidateMessage(catalog); err == nil || !strings.Contains(err.Error(), "placement_reference_point.y") {
				t.Fatalf("invalid placement coordinate: %v", err)
			}
		})
	}
}

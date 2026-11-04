package protocolv2

import (
	"strings"
	"testing"

	delivery "github.com/unframe-dev/unframe/app/server/realtime/internal/gen/delivery"
	"google.golang.org/protobuf/proto"
)

func textureResidencyFixture() *delivery.TextureResidencyPlan {
	return &delivery.TextureResidencyPlan{
		BudgetTierId: "tier", InitialGroupId: "a",
		Textures: []*delivery.TextureResidencyBinding{
			{AssetId: "image-a", Checksum: "sha256:" + strings.Repeat("a", 64), PixelSize: &delivery.PixelSize{Width: 2, Height: 2}, DecodedGpuBytes: 16, PeakLoadCpuBytes: 40},
			{AssetId: "image-b", Checksum: "sha256:" + strings.Repeat("b", 64), PixelSize: &delivery.PixelSize{Width: 1, Height: 1}, DecodedGpuBytes: 4, PeakLoadCpuBytes: 12},
		},
		GroupWindows:         []*delivery.TextureResidencyWindow{{GroupId: "a", AssetIds: []string{"image-a"}}, {GroupId: "b", AssetIds: []string{"image-b"}}},
		TotalDecodedGpuBytes: 20, MaximumPeakLoadCpuBytes: 40, MaximumResidentGpuBytes: 16, MaximumResidentTextureBindings: 1,
	}
}

func TestTextureResidencyAdmitsGroupWindowsRatherThanWholeCatalog(t *testing.T) {
	if err := ValidateMessage(textureResidencyFixture()); err != nil {
		t.Fatal(err)
	}
	empty := &delivery.TextureResidencyPlan{BudgetTierId: "tier", InitialGroupId: "a", GroupWindows: []*delivery.TextureResidencyWindow{{GroupId: "a"}}}
	if err := ValidateMessage(empty); err != nil {
		t.Fatalf("empty window rejected: %v", err)
	}
}

func TestTextureResidencyRejectsUnverifiableGroupBudgets(t *testing.T) {
	for name, mutate := range map[string]func(*delivery.TextureResidencyPlan){
		"missing initial group":    func(v *delivery.TextureResidencyPlan) { v.InitialGroupId = "missing" },
		"duplicate group":          func(v *delivery.TextureResidencyPlan) { v.GroupWindows[1].GroupId = "a" },
		"unknown asset":            func(v *delivery.TextureResidencyPlan) { v.GroupWindows[0].AssetIds = []string{"missing"} },
		"duplicate asset":          func(v *delivery.TextureResidencyPlan) { v.GroupWindows[0].AssetIds = []string{"image-a", "image-a"} },
		"incorrect catalog total":  func(v *delivery.TextureResidencyPlan) { v.TotalDecodedGpuBytes = 16 },
		"incorrect resident bytes": func(v *delivery.TextureResidencyPlan) { v.MaximumResidentGpuBytes = 20 },
		"incorrect binding count":  func(v *delivery.TextureResidencyPlan) { v.MaximumResidentTextureBindings = 2 },
		"incorrect load peak":      func(v *delivery.TextureResidencyPlan) { v.MaximumPeakLoadCpuBytes = 12 },
		"duplicate checksum":       func(v *delivery.TextureResidencyPlan) { v.Textures[1].Checksum = v.Textures[0].Checksum },
		"overflow":                 func(v *delivery.TextureResidencyPlan) { v.Textures[0].DecodedGpuBytes = ^uint64(0) },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := proto.Clone(textureResidencyFixture()).(*delivery.TextureResidencyPlan)
			mutate(candidate)
			if ValidateMessage(candidate) == nil {
				t.Fatal("invalid residency admitted")
			}
		})
	}
}

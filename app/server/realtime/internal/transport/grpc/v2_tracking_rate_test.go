package grpc

import (
	"testing"
	"time"
)

func TestV2TrackingRateDropsOverNinetyAndClosesAfterThreeDropWindows(t *testing.T) {
	var rate v2TrackingRate
	start := time.Unix(100, 0)
	for window := 0; window < 3; window++ {
		at := start.Add(time.Duration(window) * time.Second)
		for index := 0; index < 90; index++ {
			if admitted, closeStream := rate.Admit(at); !admitted || closeStream {
				t.Fatalf("window %d frame %d admitted=%v close=%v", window, index, admitted, closeStream)
			}
		}
		if admitted, closeStream := rate.Admit(at); admitted || closeStream {
			t.Fatalf("window %d overflow admitted=%v close=%v", window, admitted, closeStream)
		}
	}
	if admitted, closeStream := rate.Admit(start.Add(3 * time.Second)); admitted || !closeStream {
		t.Fatalf("third dropped window did not close: admitted=%v close=%v", admitted, closeStream)
	}
}

func TestV2TrackingRateUsesRollingSecondAndResetsConsecutiveDropWindows(t *testing.T) {
	var rate v2TrackingRate
	start := time.Unix(100, 0)
	for index := 0; index < 90; index++ {
		rate.Admit(start)
	}
	if admitted, _ := rate.Admit(start.Add(999 * time.Millisecond)); admitted {
		t.Fatal("rolling second admitted excess")
	}
	if admitted, closeStream := rate.Admit(start.Add(time.Second)); !admitted || closeStream {
		t.Fatalf("expired rolling second rejected: admitted=%v close=%v", admitted, closeStream)
	}
	if admitted, closeStream := rate.Admit(start.Add(2 * time.Second)); !admitted || closeStream {
		t.Fatalf("clean window did not reset: admitted=%v close=%v", admitted, closeStream)
	}
}

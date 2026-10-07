package grpc

import "time"

type v2TrackingRate struct {
	accepted                  []time.Time
	windowStart               time.Time
	droppedInWindow           bool
	consecutiveDroppedWindows int
}

func (r *v2TrackingRate) Admit(now time.Time) (admitted bool, closeStream bool) {
	if r.windowStart.IsZero() {
		r.windowStart = now
	}
	if elapsed := now.Sub(r.windowStart); elapsed >= time.Second {
		windows := int(elapsed / time.Second)
		if r.droppedInWindow {
			r.consecutiveDroppedWindows++
		} else {
			r.consecutiveDroppedWindows = 0
		}
		if windows > 1 {
			r.consecutiveDroppedWindows = 0
		}
		r.windowStart = r.windowStart.Add(time.Duration(windows) * time.Second)
		r.droppedInWindow = false
		if r.consecutiveDroppedWindows >= 3 {
			return false, true
		}
	}
	cutoff := now.Add(-time.Second)
	first := 0
	for first < len(r.accepted) && !r.accepted[first].After(cutoff) {
		first++
	}
	r.accepted = r.accepted[first:]
	if len(r.accepted) >= 90 {
		r.droppedInWindow = true
		return false, false
	}
	r.accepted = append(r.accepted, now)
	return true, false
}

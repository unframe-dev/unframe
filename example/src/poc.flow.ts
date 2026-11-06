import type { FlowGroupDeclaration } from "@unframe-dev/authoring";
export const pocHistory = {
  id: "poc-history",
  initialStepId: "poc-overview",
  steps: {
    "poc-overview": {
      id: "poc-overview",
      cues: [
        {
          id: "poc-overview-start",
          trigger: {
            kind: "timer",
            afterMilliseconds: 1,
          },
          actions: [
            {
              kind: "timeline.play",
              timelineId: "poc-overview",
              completion: "nonBlocking",
            },
          ],
        },
        {
          id: "poc-overview-complete",
          trigger: {
            kind: "timelineCompleted",
            timelineId: "poc-overview",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-overview-ready",
          },
        },
      ],
    },
    "poc-overview-ready": {
      id: "poc-overview-ready",
      cues: [
        {
          id: "poc-overview-next",
          trigger: {
            kind: "logicalInput",
            action: "presenter.next",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-focus-1",
          },
        },
      ],
    },
    "poc-focus-1": {
      id: "poc-focus-1",
      cues: [
        {
          id: "poc-focus-1-start",
          trigger: {
            kind: "timer",
            afterMilliseconds: 1,
          },
          actions: [
            {
              kind: "timeline.play",
              timelineId: "poc-focus-1",
              completion: "nonBlocking",
            },
          ],
        },
        {
          id: "poc-focus-1-complete",
          trigger: {
            kind: "timelineCompleted",
            timelineId: "poc-focus-1",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-focus-1-ready",
          },
        },
      ],
    },
    "poc-focus-1-ready": {
      id: "poc-focus-1-ready",
      cues: [
        {
          id: "poc-focus-1-next",
          trigger: {
            kind: "logicalInput",
            action: "presenter.next",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-focus-2",
          },
        },
      ],
    },
    "poc-focus-2": {
      id: "poc-focus-2",
      cues: [
        {
          id: "poc-focus-2-start",
          trigger: {
            kind: "timer",
            afterMilliseconds: 1,
          },
          actions: [
            {
              kind: "timeline.play",
              timelineId: "poc-focus-2",
              completion: "nonBlocking",
            },
          ],
        },
        {
          id: "poc-focus-2-complete",
          trigger: {
            kind: "timelineCompleted",
            timelineId: "poc-focus-2",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-focus-2-ready",
          },
        },
      ],
    },
    "poc-focus-2-ready": {
      id: "poc-focus-2-ready",
      cues: [
        {
          id: "poc-focus-2-next",
          trigger: {
            kind: "logicalInput",
            action: "presenter.next",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-focus-3",
          },
        },
      ],
    },
    "poc-focus-3": {
      id: "poc-focus-3",
      cues: [
        {
          id: "poc-focus-3-start",
          trigger: {
            kind: "timer",
            afterMilliseconds: 1,
          },
          actions: [
            {
              kind: "timeline.play",
              timelineId: "poc-focus-3",
              completion: "nonBlocking",
            },
          ],
        },
        {
          id: "poc-focus-3-complete",
          trigger: {
            kind: "timelineCompleted",
            timelineId: "poc-focus-3",
          },
          actions: [],
          next: {
            kind: "step",
            stepId: "poc-focus-3-ready",
          },
        },
      ],
    },
    "poc-focus-3-ready": {
      id: "poc-focus-3-ready",
      cues: [
        {
          id: "poc-swipe-right",
          trigger: { kind: "gesture", gesture: "swipeRight" },
          actions: [],
          next: { kind: "step", stepId: "poc-exit" },
        },
      ],
    },
    "poc-exit": {
      id: "poc-exit",
      cues: [
        {
          id: "poc-exit-start",
          trigger: { kind: "timer", afterMilliseconds: 1 },
          actions: [{ kind: "timeline.play", timelineId: "poc-exit", completion: "nonBlocking" }],
        },
        {
          id: "poc-exit-complete",
          trigger: { kind: "timelineCompleted", timelineId: "poc-exit" },
          actions: [],
          next: { kind: "group", groupId: "reaction-float" },
        },
      ],
    },
  },
} as const satisfies FlowGroupDeclaration;

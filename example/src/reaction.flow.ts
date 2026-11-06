import type { FlowGroupDeclaration } from "@unframe-dev/authoring";

export const reactionGroups = {
  "reaction-float": {
    id: "reaction-float",
    initialStepId: "reaction-float-wait",
    steps: {
      "reaction-float-wait": {
        id: "reaction-float-wait",
        cues: [
          {
            id: "reaction-float-swipe-up",
            trigger: {
              kind: "gesture",
              gesture: "swipeUp",
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-float-enter",
                completion: "nonBlocking",
              },
            ],
            next: {
              kind: "step",
              stepId: "reaction-float-enter",
            },
          },
        ],
      },
      "reaction-float-enter": {
        id: "reaction-float-enter",
        cues: [
          {
            id: "reaction-float-enter-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "reaction-float-enter",
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-bob",
                completion: "nonBlocking",
              },
            ],
            next: {
              kind: "step",
              stepId: "reaction-float-bobbing",
            },
          },
        ],
      },
      "reaction-float-bobbing": {
        id: "reaction-float-bobbing",
        cues: [
          {
            id: "reaction-bob-repeat",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "reaction-bob",
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-bob",
                completion: "nonBlocking",
              },
            ],
            firePolicy: {
              kind: "repeatable",
            },
          },
          {
            id: "reaction-float-swipe-left",
            trigger: {
              kind: "gesture",
              gesture: "swipeLeft",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "reaction-sense",
            },
          },
        ],
      },
    },
  },
  "reaction-sense": {
    id: "reaction-sense",
    initialStepId: "reaction-sense-enter",
    steps: {
      "reaction-sense-enter": {
        id: "reaction-sense-enter",
        cues: [
          {
            id: "reaction-sense-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-sense-enter",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "reaction-sense-enter-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "reaction-sense-enter",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "reaction-gaze-wait",
            },
          },
        ],
      },
      "reaction-gaze-wait": {
        id: "reaction-gaze-wait",
        cues: [
          {
            id: "reaction-gaze-zone",
            trigger: {
              kind: "zoneEdge",
              zoneId: "reaction-gaze-stage",
              edge: "enter",
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-gaze-focus",
                completion: "nonBlocking",
              },
            ],
            next: {
              kind: "step",
              stepId: "reaction-gaze-focus",
            },
          },
        ],
      },
      "reaction-gaze-focus": {
        id: "reaction-gaze-focus",
        cues: [
          {
            id: "reaction-gaze-focus-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "reaction-gaze-focus",
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-gaze-zoom",
                completion: "nonBlocking",
              },
            ],
            next: {
              kind: "step",
              stepId: "reaction-gaze-zoom",
            },
          },
        ],
      },
      "reaction-gaze-zoom": {
        id: "reaction-gaze-zoom",
        cues: [
          {
            id: "reaction-gaze-hold",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "reaction-hold",
            },
          },
        ],
      },
    },
  },
  "reaction-hold": {
    id: "reaction-hold",
    initialStepId: "reaction-hold",
    steps: {
      "reaction-hold": {
        id: "reaction-hold",
        cues: [
          {
            id: "reaction-hold-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "reaction-exit",
            },
          },
        ],
      },
      "reaction-exit": {
        id: "reaction-exit",
        cues: [
          {
            id: "reaction-exit-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "reaction-exit",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "reaction-exit-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "reaction-exit",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "closing-wait",
            },
          },
        ],
      },
    },
  },
} as const satisfies Readonly<Record<string, FlowGroupDeclaration>>;

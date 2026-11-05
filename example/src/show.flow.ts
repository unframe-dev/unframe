import type { FlowGroupDeclaration, FlowStepDeclaration } from "@unframe-dev/authoring";

export const originalDismissed = {
  id: "original-dismissed",
  cues: [
    {
      id: "original-dismissed-next",
      trigger: {
        kind: "logicalInput",
        action: "presenter.next",
      },
      actions: [],
      next: {
        kind: "group",
        groupId: "expression",
      },
    },
  ],
} as const satisfies FlowStepDeclaration;

export const showGroups = {
  expression: {
    id: "expression",
    initialStepId: "expression",
    steps: {
      expression: {
        id: "expression",
        cues: [
          {
            id: "expression-trail-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "effect.start",
                effectId: "expression-left-trail",
                nodeId: "expression-trail-root",
                owner: {
                  kind: "group",
                  groupId: "expression",
                },
                seed: 0,
                effect: {
                  kind: "handGlow",
                  hand: "left",
                  size: 1,
                  color: {
                    red: 0.7,
                    green: 0.75,
                    blue: 1,
                    alpha: 0.9,
                  },
                  speed: 1,
                  durationMilliseconds: 60000,
                },
              },
              {
                kind: "effect.start",
                effectId: "expression-right-trail",
                nodeId: "expression-trail-root",
                owner: {
                  kind: "group",
                  groupId: "expression",
                },
                seed: 0,
                effect: {
                  kind: "handGlow",
                  hand: "right",
                  size: 1,
                  color: {
                    red: 0.7,
                    green: 0.75,
                    blue: 1,
                    alpha: 0.9,
                  },
                  speed: 1,
                  durationMilliseconds: 60000,
                },
              },
            ],
          },
          {
            id: "expression-circle",
            trigger: {
              kind: "gesture",
              gesture: "circle",
            },
            actions: [
              {
                kind: "effect.stop",
                effectId: "expression-left-trail",
              },
              {
                kind: "effect.stop",
                effectId: "expression-right-trail",
              },
            ],
            next: {
              kind: "step",
              stepId: "expression-draw",
            },
          },
          {
            id: "expression-trail-renew",
            trigger: {
              kind: "timer",
              afterMilliseconds: 60000,
            },
            actions: [
              {
                kind: "effect.stop",
                effectId: "expression-left-trail",
              },
              {
                kind: "effect.stop",
                effectId: "expression-right-trail",
              },
            ],
            next: {
              kind: "step",
              stepId: "expression",
            },
          },
        ],
      },
      "expression-draw": {
        id: "expression-draw",
        cues: [
          {
            id: "expression-draw-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "expression-draw",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "expression-draw-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "expression-draw",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "expression-drawn",
            },
          },
        ],
      },
      "expression-drawn": {
        id: "expression-drawn",
        cues: [
          {
            id: "expression-throw",
            trigger: {
              kind: "gesture",
              gesture: "throw",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "expression-move",
            },
          },
        ],
      },
      "expression-move": {
        id: "expression-move",
        cues: [
          {
            id: "expression-move-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "expression-move",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "expression-move-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "expression-move",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "expression-ready",
            },
          },
        ],
      },
      "expression-ready": {
        id: "expression-ready",
        cues: [
          {
            id: "expression-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "journey",
            },
          },
        ],
      },
    },
  },
  journey: {
    id: "journey",
    initialStepId: "journey-zone",
    steps: {
      "journey-zone": {
        id: "journey-zone",
        cues: [
          {
            id: "journey-zone-enter",
            trigger: {
              kind: "zoneEdge",
              zoneId: "journey-stage",
              edge: "enter",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-frame",
            },
          },
        ],
      },
      "journey-frame": {
        id: "journey-frame",
        cues: [
          {
            id: "journey-frame-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "journey-frame",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "journey-frame-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "journey-frame",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-framed",
            },
          },
        ],
      },
      "journey-framed": {
        id: "journey-framed",
        cues: [
          {
            id: "journey-spread",
            trigger: {
              kind: "gesture",
              gesture: "spreadHands",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-goal",
            },
          },
        ],
      },
      "journey-goal": {
        id: "journey-goal",
        cues: [
          {
            id: "journey-goal-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "journey-goal",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "journey-goal-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "journey-goal",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-goal-ready",
            },
          },
        ],
      },
      "journey-goal-ready": {
        id: "journey-goal-ready",
        cues: [
          {
            id: "journey-goal-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "conditions",
            },
          },
        ],
      },
    },
  },

  conditions: {
    id: "conditions",
    initialStepId: "conditions",
    steps: {
      conditions: {
        id: "conditions",
        cues: [
          {
            id: "conditions-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "conditions",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "conditions-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "conditions",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "conditions-ready",
            },
          },
        ],
      },
      "conditions-ready": {
        id: "conditions-ready",
        cues: [
          {
            id: "conditions-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "content-action",
            },
          },
        ],
      },
    },
  },
  "content-action": {
    id: "content-action",
    initialStepId: "content-action",
    steps: {
      "content-action": {
        id: "content-action",
        cues: [
          {
            id: "content-action-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "content-action",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "content-action-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "content-action",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "content-action-ready",
            },
          },
        ],
      },
      "content-action-ready": {
        id: "content-action-ready",
        cues: [
          {
            id: "content-action-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "space-sharing",
            },
          },
        ],
      },
    },
  },
  "space-sharing": {
    id: "space-sharing",
    initialStepId: "space-sharing",
    steps: {
      "space-sharing": {
        id: "space-sharing",
        cues: [
          {
            id: "space-sharing-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "space-sharing",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "space-sharing-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "space-sharing",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "space-sharing-ready",
            },
          },
        ],
      },
      "space-sharing-ready": {
        id: "space-sharing-ready",
        cues: [
          {
            id: "space-sharing-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "summary",
            },
          },
        ],
      },
    },
  },
  summary: {
    id: "summary",
    initialStepId: "summary",
    steps: {
      summary: {
        id: "summary",
        cues: [
          {
            id: "summary-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "summary",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "summary-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "summary",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "summary-ready",
            },
          },
        ],
      },
      "summary-ready": {
        id: "summary-ready",
        cues: [
          {
            id: "summary-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "ordinary-slides",
            },
          },
        ],
      },
    },
  },
  "ordinary-slides": {
    id: "ordinary-slides",
    initialStepId: "ordinary-slides",
    steps: {
      "ordinary-slides": {
        id: "ordinary-slides",
        cues: [
          {
            id: "ordinary-slides-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "end",
            },
          },
        ],
      },
    },
  },
} as const satisfies Readonly<Record<string, FlowGroupDeclaration>>;

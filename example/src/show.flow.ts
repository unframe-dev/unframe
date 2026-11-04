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
            id: "expression-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "expression",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "expression-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "expression",
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
    initialStepId: "journey-goal",
    steps: {
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
              kind: "step",
              stepId: "journey-challenge",
            },
          },
        ],
      },
      "journey-challenge": {
        id: "journey-challenge",
        cues: [
          {
            id: "journey-challenge-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "journey-challenge",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "journey-challenge-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "journey-challenge",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-challenge-ready",
            },
          },
        ],
      },
      "journey-challenge-ready": {
        id: "journey-challenge-ready",
        cues: [
          {
            id: "journey-challenge-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-prototype",
            },
          },
        ],
      },
      "journey-prototype": {
        id: "journey-prototype",
        cues: [
          {
            id: "journey-prototype-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "journey-prototype",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "journey-prototype-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "journey-prototype",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-prototype-ready",
            },
          },
        ],
      },
      "journey-prototype-ready": {
        id: "journey-prototype-ready",
        cues: [
          {
            id: "journey-prototype-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-discovery",
            },
          },
        ],
      },
      "journey-discovery": {
        id: "journey-discovery",
        cues: [
          {
            id: "journey-discovery-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "journey-discovery",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "journey-discovery-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "journey-discovery",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-discovery-ready",
            },
          },
        ],
      },
      "journey-discovery-ready": {
        id: "journey-discovery-ready",
        cues: [
          {
            id: "journey-discovery-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "journey-exit",
            },
          },
        ],
      },
      "journey-exit": {
        id: "journey-exit",
        cues: [
          {
            id: "journey-exit-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "journey-exit",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "journey-exit-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "journey-exit",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "comparison",
            },
          },
        ],
      },
    },
  },
  comparison: {
    id: "comparison",
    initialStepId: "comparison-expected",
    steps: {
      "comparison-expected": {
        id: "comparison-expected",
        cues: [
          {
            id: "comparison-expected-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "comparison-expected",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "comparison-expected-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "comparison-expected",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "comparison-expected-ready",
            },
          },
        ],
      },
      "comparison-expected-ready": {
        id: "comparison-expected-ready",
        cues: [
          {
            id: "comparison-expected-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "comparison-observed",
            },
          },
        ],
      },
      "comparison-observed": {
        id: "comparison-observed",
        cues: [
          {
            id: "comparison-observed-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "comparison-observed",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "comparison-observed-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "comparison-observed",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "comparison-observed-ready",
            },
          },
        ],
      },
      "comparison-observed-ready": {
        id: "comparison-observed-ready",
        cues: [
          {
            id: "comparison-observed-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "showcase",
            },
          },
        ],
      },
      showcase: {
        id: "showcase",
        cues: [
          {
            id: "showcase-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "showcase",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "showcase-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "showcase",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "showcase-ready",
            },
          },
        ],
      },
      "showcase-ready": {
        id: "showcase-ready",
        cues: [
          {
            id: "showcase-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "group",
              groupId: "technology",
            },
          },
        ],
      },
    },
  },
  technology: {
    id: "technology",
    initialStepId: "technology",
    steps: {
      technology: {
        id: "technology",
        cues: [
          {
            id: "technology-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "technology",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "technology-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "technology",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "technology-ready",
            },
          },
        ],
      },
      "technology-ready": {
        id: "technology-ready",
        cues: [
          {
            id: "technology-ready-next",
            trigger: {
              kind: "logicalInput",
              action: "presenter.next",
            },
            actions: [],
            next: {
              kind: "step",
              stepId: "closing",
            },
          },
        ],
      },
      closing: {
        id: "closing",
        cues: [
          {
            id: "closing-start",
            trigger: {
              kind: "timer",
              afterMilliseconds: 1,
            },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "closing",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "closing-complete",
            trigger: {
              kind: "timelineCompleted",
              timelineId: "closing",
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

import { pocHistory } from "./poc.flow";
import { reactionGroups } from "./reaction.flow";
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
  "poc-history": pocHistory,
  ...reactionGroups,
  expression: {
    id: "expression",
    initialStepId: "expression-wait",
    steps: {
      "expression-wait": {
        id: "expression-wait",
        cues: [
          {
            id: "start-expression",
            trigger: { kind: "logicalInput", action: "presenter.next" },
            actions: [],
            next: { kind: "step", stepId: "expression" },
          },
        ],
      },
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
              stepId: "expression-message",
            },
          },
        ],
      },
      "expression-message": {
        id: "expression-message",
        cues: [
          {
            id: "expression-message-start",
            trigger: { kind: "timer", afterMilliseconds: 1 },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "expression-message",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "expression-message-complete",
            trigger: { kind: "timelineCompleted", timelineId: "expression-message" },
            actions: [],
            next: { kind: "step", stepId: "expression-ready" },
          },
        ],
      },
      "expression-ready": {
        id: "expression-ready",
        cues: [
          {
            id: "expression-swipe-left",
            trigger: { kind: "gesture", gesture: "swipeLeft" },
            actions: [],
            next: { kind: "step", stepId: "expression-exit" },
          },
        ],
      },
      "expression-exit": {
        id: "expression-exit",
        cues: [
          {
            id: "expression-exit-start",
            trigger: { kind: "timer", afterMilliseconds: 1 },
            actions: [
              {
                kind: "timeline.play",
                timelineId: "expression-exit",
                completion: "nonBlocking",
              },
            ],
          },
          {
            id: "expression-exit-complete",
            trigger: { kind: "timelineCompleted", timelineId: "expression-exit" },
            actions: [],
            next: { kind: "group", groupId: "journey" },
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
            id: "journey-pull",
            trigger: { kind: "gesture", gesture: "pullBackward" },
            actions: [],
            next: { kind: "step", stepId: "journey-exit" },
          },
        ],
      },
      "journey-exit": {
        id: "journey-exit",
        cues: [
          {
            id: "journey-exit-start",
            trigger: { kind: "timer", afterMilliseconds: 1 },
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
            trigger: { kind: "timelineCompleted", timelineId: "journey-exit" },
            actions: [],
            next: { kind: "group", groupId: "poc-history" },
          },
        ],
      },
    },
  },

  "closing-wait": {
    id: "closing-wait",
    initialStepId: "closing-wait",
    steps: {
      "closing-wait": {
        id: "closing-wait",
        cues: [
          {
            id: "closing-zone-enter",
            trigger: { kind: "zoneEdge", zoneId: "closing-stage", edge: "enter" },
            actions: [],
            next: { kind: "group", groupId: "closing" },
          },
        ],
      },
    },
  },
  closing: {
    id: "closing",
    initialStepId: "closing",
    steps: {
      closing: {
        id: "closing",
        cues: [
          {
            id: "closing-start",
            trigger: { kind: "timer", afterMilliseconds: 1 },
            actions: [{ kind: "timeline.play", timelineId: "closing", completion: "nonBlocking" }],
          },
          {
            id: "closing-complete",
            trigger: { kind: "timelineCompleted", timelineId: "closing" },
            actions: [],
            next: { kind: "end" },
          },
        ],
      },
    },
  },
} as const satisfies Readonly<Record<string, FlowGroupDeclaration>>;

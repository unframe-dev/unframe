// Generated from openapi/control-plane.openapi.json. Do not edit.
export interface paths {
    "/presentations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Collection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            presentations: {
                                createdAt: string;
                                /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                                definition: {
                                    assets: {
                                        assetId: string;
                                    }[];
                                    groups: {
                                        anchoredElementGroups: {
                                            /** @enum {string} */
                                            anchor: "head" | "leftHand" | "rightHand" | "body";
                                            elementIds: string[];
                                            id: string;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        }[];
                                        elements: ({
                                            content: {
                                                text: string;
                                            };
                                            id: string;
                                            initialState: {
                                                active: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                visible: boolean;
                                            };
                                            /** @enum {string} */
                                            type: "text";
                                        } | {
                                            content: {
                                                /** @enum {string} */
                                                shape: "cube" | "sphere" | "plane";
                                            };
                                            id: string;
                                            initialState: {
                                                active: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                visible: boolean;
                                            };
                                            /** @enum {string} */
                                            type: "shape";
                                        } | {
                                            content: {
                                                assetId: string;
                                            };
                                            id: string;
                                            initialState: {
                                                active: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                visible: boolean;
                                            };
                                            /** @enum {string} */
                                            type: "image";
                                        } | {
                                            content: {
                                                assetId: string;
                                            };
                                            id: string;
                                            initialState: {
                                                active: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                visible: boolean;
                                            };
                                            /** @enum {string} */
                                            type: "video";
                                        } | {
                                            content: {
                                                assetId: string;
                                            };
                                            id: string;
                                            initialState: {
                                                active: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                visible: boolean;
                                            };
                                            /** @enum {string} */
                                            type: "model";
                                        } | {
                                            content: {
                                                assetId: string;
                                            };
                                            id: string;
                                            initialState: {
                                                active: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                visible: boolean;
                                            };
                                            /** @enum {string} */
                                            type: "audio";
                                        })[];
                                        id: string;
                                        steps: {
                                            cues: {
                                                actions: ({
                                                    active: boolean;
                                                    /** @enum {string} */
                                                    kind: "setActive";
                                                    targetElementId: string;
                                                    transition?: {
                                                        delaySeconds: number;
                                                        durationSeconds: number;
                                                    };
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "setVisible";
                                                    targetElementId: string;
                                                    transition?: {
                                                        delaySeconds: number;
                                                        durationSeconds: number;
                                                    };
                                                    visible: boolean;
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "setOpacity";
                                                    opacity: number;
                                                    targetElementId: string;
                                                    transition?: {
                                                        delaySeconds: number;
                                                        durationSeconds: number;
                                                    };
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "setTransform";
                                                    targetElementId: string;
                                                    transform: {
                                                        position: number[];
                                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                        rotation: number[];
                                                        scale: number[];
                                                    };
                                                    transition?: {
                                                        delaySeconds: number;
                                                        durationSeconds: number;
                                                    };
                                                })[];
                                                id: string;
                                                next: {
                                                    /** @enum {string} */
                                                    kind: "step";
                                                    stepId: string;
                                                } | {
                                                    groupId: string;
                                                    /** @enum {string} */
                                                    kind: "group";
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "end";
                                                };
                                                trigger: {
                                                    action: string;
                                                    /** @enum {string} */
                                                    kind: "button";
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "enterZone";
                                                    zoneId: string;
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "motion";
                                                    minimumDistanceMeters: number;
                                                };
                                            }[];
                                            id: string;
                                        }[];
                                    }[];
                                    metadata: {
                                        description?: string;
                                        title: string;
                                    };
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    stage: {
                                        coordinateSystem: {
                                            /** @enum {string} */
                                            forwardAxis: "-Z";
                                            /** @enum {string} */
                                            handedness: "right";
                                            /** @enum {string} */
                                            unit: "meter";
                                            /** @enum {string} */
                                            upAxis: "+Y";
                                        };
                                        size: number[];
                                        zones: {
                                            bounds: {
                                                max: number[];
                                                min: number[];
                                            };
                                            id: string;
                                        }[];
                                    };
                                };
                                id: string;
                                revision: number;
                                updatedAt: string;
                            }[];
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        assets: {
                            assetId: string;
                        }[];
                        groups: {
                            anchoredElementGroups: {
                                /** @enum {string} */
                                anchor: "head" | "leftHand" | "rightHand" | "body";
                                elementIds: string[];
                                id: string;
                                transform: {
                                    position: number[];
                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                    rotation: number[];
                                    scale: number[];
                                };
                            }[];
                            elements: ({
                                content: {
                                    text: string;
                                };
                                id: string;
                                initialState: {
                                    active: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    visible: boolean;
                                };
                                /** @enum {string} */
                                type: "text";
                            } | {
                                content: {
                                    /** @enum {string} */
                                    shape: "cube" | "sphere" | "plane";
                                };
                                id: string;
                                initialState: {
                                    active: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    visible: boolean;
                                };
                                /** @enum {string} */
                                type: "shape";
                            } | {
                                content: {
                                    assetId: string;
                                };
                                id: string;
                                initialState: {
                                    active: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    visible: boolean;
                                };
                                /** @enum {string} */
                                type: "image";
                            } | {
                                content: {
                                    assetId: string;
                                };
                                id: string;
                                initialState: {
                                    active: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    visible: boolean;
                                };
                                /** @enum {string} */
                                type: "video";
                            } | {
                                content: {
                                    assetId: string;
                                };
                                id: string;
                                initialState: {
                                    active: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    visible: boolean;
                                };
                                /** @enum {string} */
                                type: "model";
                            } | {
                                content: {
                                    assetId: string;
                                };
                                id: string;
                                initialState: {
                                    active: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    visible: boolean;
                                };
                                /** @enum {string} */
                                type: "audio";
                            })[];
                            id: string;
                            steps: {
                                cues: {
                                    actions: ({
                                        active: boolean;
                                        /** @enum {string} */
                                        kind: "setActive";
                                        targetElementId: string;
                                        transition?: {
                                            delaySeconds: number;
                                            durationSeconds: number;
                                        };
                                    } | {
                                        /** @enum {string} */
                                        kind: "setVisible";
                                        targetElementId: string;
                                        transition?: {
                                            delaySeconds: number;
                                            durationSeconds: number;
                                        };
                                        visible: boolean;
                                    } | {
                                        /** @enum {string} */
                                        kind: "setOpacity";
                                        opacity: number;
                                        targetElementId: string;
                                        transition?: {
                                            delaySeconds: number;
                                            durationSeconds: number;
                                        };
                                    } | {
                                        /** @enum {string} */
                                        kind: "setTransform";
                                        targetElementId: string;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        transition?: {
                                            delaySeconds: number;
                                            durationSeconds: number;
                                        };
                                    })[];
                                    id: string;
                                    next: {
                                        /** @enum {string} */
                                        kind: "step";
                                        stepId: string;
                                    } | {
                                        groupId: string;
                                        /** @enum {string} */
                                        kind: "group";
                                    } | {
                                        /** @enum {string} */
                                        kind: "end";
                                    };
                                    trigger: {
                                        action: string;
                                        /** @enum {string} */
                                        kind: "button";
                                    } | {
                                        /** @enum {string} */
                                        kind: "enterZone";
                                        zoneId: string;
                                    } | {
                                        /** @enum {string} */
                                        kind: "motion";
                                        minimumDistanceMeters: number;
                                    };
                                }[];
                                id: string;
                            }[];
                        }[];
                        metadata: {
                            description?: string;
                            title: string;
                        };
                        /** @enum {number} */
                        schemaVersion: 1;
                        stage: {
                            coordinateSystem: {
                                /** @enum {string} */
                                forwardAxis: "-Z";
                                /** @enum {string} */
                                handedness: "right";
                                /** @enum {string} */
                                unit: "meter";
                                /** @enum {string} */
                                upAxis: "+Y";
                            };
                            size: number[];
                            zones: {
                                bounds: {
                                    max: number[];
                                    min: number[];
                                };
                                id: string;
                            }[];
                        };
                    } & {
                        assets: {
                            assetId: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                            definition: {
                                assets: {
                                    assetId: string;
                                }[];
                                groups: {
                                    anchoredElementGroups: {
                                        /** @enum {string} */
                                        anchor: "head" | "leftHand" | "rightHand" | "body";
                                        elementIds: string[];
                                        id: string;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    }[];
                                    elements: ({
                                        content: {
                                            text: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "text";
                                    } | {
                                        content: {
                                            /** @enum {string} */
                                            shape: "cube" | "sphere" | "plane";
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "shape";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "image";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "video";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "model";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "audio";
                                    })[];
                                    id: string;
                                    steps: {
                                        cues: {
                                            actions: ({
                                                active: boolean;
                                                /** @enum {string} */
                                                kind: "setActive";
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setVisible";
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                                visible: boolean;
                                            } | {
                                                /** @enum {string} */
                                                kind: "setOpacity";
                                                opacity: number;
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setTransform";
                                                targetElementId: string;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            })[];
                                            id: string;
                                            next: {
                                                /** @enum {string} */
                                                kind: "step";
                                                stepId: string;
                                            } | {
                                                groupId: string;
                                                /** @enum {string} */
                                                kind: "group";
                                            } | {
                                                /** @enum {string} */
                                                kind: "end";
                                            };
                                            trigger: {
                                                action: string;
                                                /** @enum {string} */
                                                kind: "button";
                                            } | {
                                                /** @enum {string} */
                                                kind: "enterZone";
                                                zoneId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "motion";
                                                minimumDistanceMeters: number;
                                            };
                                        }[];
                                        id: string;
                                    }[];
                                }[];
                                metadata: {
                                    description?: string;
                                    title: string;
                                };
                                /** @enum {number} */
                                schemaVersion: 1;
                                stage: {
                                    coordinateSystem: {
                                        /** @enum {string} */
                                        forwardAxis: "-Z";
                                        /** @enum {string} */
                                        handedness: "right";
                                        /** @enum {string} */
                                        unit: "meter";
                                        /** @enum {string} */
                                        upAxis: "+Y";
                                    };
                                    size: number[];
                                    zones: {
                                        bounds: {
                                            max: number[];
                                            min: number[];
                                        };
                                        id: string;
                                    }[];
                                };
                            };
                            id: string;
                            revision: number;
                            updatedAt: string;
                        };
                    };
                };
                /** @description Invalid definition */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/presentations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Presentation */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                            definition: {
                                assets: {
                                    assetId: string;
                                }[];
                                groups: {
                                    anchoredElementGroups: {
                                        /** @enum {string} */
                                        anchor: "head" | "leftHand" | "rightHand" | "body";
                                        elementIds: string[];
                                        id: string;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    }[];
                                    elements: ({
                                        content: {
                                            text: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "text";
                                    } | {
                                        content: {
                                            /** @enum {string} */
                                            shape: "cube" | "sphere" | "plane";
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "shape";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "image";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "video";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "model";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "audio";
                                    })[];
                                    id: string;
                                    steps: {
                                        cues: {
                                            actions: ({
                                                active: boolean;
                                                /** @enum {string} */
                                                kind: "setActive";
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setVisible";
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                                visible: boolean;
                                            } | {
                                                /** @enum {string} */
                                                kind: "setOpacity";
                                                opacity: number;
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setTransform";
                                                targetElementId: string;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            })[];
                                            id: string;
                                            next: {
                                                /** @enum {string} */
                                                kind: "step";
                                                stepId: string;
                                            } | {
                                                groupId: string;
                                                /** @enum {string} */
                                                kind: "group";
                                            } | {
                                                /** @enum {string} */
                                                kind: "end";
                                            };
                                            trigger: {
                                                action: string;
                                                /** @enum {string} */
                                                kind: "button";
                                            } | {
                                                /** @enum {string} */
                                                kind: "enterZone";
                                                zoneId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "motion";
                                                minimumDistanceMeters: number;
                                            };
                                        }[];
                                        id: string;
                                    }[];
                                }[];
                                metadata: {
                                    description?: string;
                                    title: string;
                                };
                                /** @enum {number} */
                                schemaVersion: 1;
                                stage: {
                                    coordinateSystem: {
                                        /** @enum {string} */
                                        forwardAxis: "-Z";
                                        /** @enum {string} */
                                        handedness: "right";
                                        /** @enum {string} */
                                        unit: "meter";
                                        /** @enum {string} */
                                        upAxis: "+Y";
                                    };
                                    size: number[];
                                    zones: {
                                        bounds: {
                                            max: number[];
                                            min: number[];
                                        };
                                        id: string;
                                    }[];
                                };
                            };
                            id: string;
                            revision: number;
                            updatedAt: string;
                        };
                    };
                };
                /** @description Invalid presentation id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                        definition: {
                            assets: {
                                assetId: string;
                            }[];
                            groups: {
                                anchoredElementGroups: {
                                    /** @enum {string} */
                                    anchor: "head" | "leftHand" | "rightHand" | "body";
                                    elementIds: string[];
                                    id: string;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                }[];
                                elements: ({
                                    content: {
                                        text: string;
                                    };
                                    id: string;
                                    initialState: {
                                        active: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        visible: boolean;
                                    };
                                    /** @enum {string} */
                                    type: "text";
                                } | {
                                    content: {
                                        /** @enum {string} */
                                        shape: "cube" | "sphere" | "plane";
                                    };
                                    id: string;
                                    initialState: {
                                        active: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        visible: boolean;
                                    };
                                    /** @enum {string} */
                                    type: "shape";
                                } | {
                                    content: {
                                        assetId: string;
                                    };
                                    id: string;
                                    initialState: {
                                        active: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        visible: boolean;
                                    };
                                    /** @enum {string} */
                                    type: "image";
                                } | {
                                    content: {
                                        assetId: string;
                                    };
                                    id: string;
                                    initialState: {
                                        active: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        visible: boolean;
                                    };
                                    /** @enum {string} */
                                    type: "video";
                                } | {
                                    content: {
                                        assetId: string;
                                    };
                                    id: string;
                                    initialState: {
                                        active: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        visible: boolean;
                                    };
                                    /** @enum {string} */
                                    type: "model";
                                } | {
                                    content: {
                                        assetId: string;
                                    };
                                    id: string;
                                    initialState: {
                                        active: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        visible: boolean;
                                    };
                                    /** @enum {string} */
                                    type: "audio";
                                })[];
                                id: string;
                                steps: {
                                    cues: {
                                        actions: ({
                                            active: boolean;
                                            /** @enum {string} */
                                            kind: "setActive";
                                            targetElementId: string;
                                            transition?: {
                                                delaySeconds: number;
                                                durationSeconds: number;
                                            };
                                        } | {
                                            /** @enum {string} */
                                            kind: "setVisible";
                                            targetElementId: string;
                                            transition?: {
                                                delaySeconds: number;
                                                durationSeconds: number;
                                            };
                                            visible: boolean;
                                        } | {
                                            /** @enum {string} */
                                            kind: "setOpacity";
                                            opacity: number;
                                            targetElementId: string;
                                            transition?: {
                                                delaySeconds: number;
                                                durationSeconds: number;
                                            };
                                        } | {
                                            /** @enum {string} */
                                            kind: "setTransform";
                                            targetElementId: string;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            transition?: {
                                                delaySeconds: number;
                                                durationSeconds: number;
                                            };
                                        })[];
                                        id: string;
                                        next: {
                                            /** @enum {string} */
                                            kind: "step";
                                            stepId: string;
                                        } | {
                                            groupId: string;
                                            /** @enum {string} */
                                            kind: "group";
                                        } | {
                                            /** @enum {string} */
                                            kind: "end";
                                        };
                                        trigger: {
                                            action: string;
                                            /** @enum {string} */
                                            kind: "button";
                                        } | {
                                            /** @enum {string} */
                                            kind: "enterZone";
                                            zoneId: string;
                                        } | {
                                            /** @enum {string} */
                                            kind: "motion";
                                            minimumDistanceMeters: number;
                                        };
                                    }[];
                                    id: string;
                                }[];
                            }[];
                            metadata: {
                                description?: string;
                                title: string;
                            };
                            /** @enum {number} */
                            schemaVersion: 1;
                            stage: {
                                coordinateSystem: {
                                    /** @enum {string} */
                                    forwardAxis: "-Z";
                                    /** @enum {string} */
                                    handedness: "right";
                                    /** @enum {string} */
                                    unit: "meter";
                                    /** @enum {string} */
                                    upAxis: "+Y";
                                };
                                size: number[];
                                zones: {
                                    bounds: {
                                        max: number[];
                                        min: number[];
                                    };
                                    id: string;
                                }[];
                            };
                        };
                        expectedRevision: number;
                    };
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                            definition: {
                                assets: {
                                    assetId: string;
                                }[];
                                groups: {
                                    anchoredElementGroups: {
                                        /** @enum {string} */
                                        anchor: "head" | "leftHand" | "rightHand" | "body";
                                        elementIds: string[];
                                        id: string;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    }[];
                                    elements: ({
                                        content: {
                                            text: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "text";
                                    } | {
                                        content: {
                                            /** @enum {string} */
                                            shape: "cube" | "sphere" | "plane";
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "shape";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "image";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "video";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "model";
                                    } | {
                                        content: {
                                            assetId: string;
                                        };
                                        id: string;
                                        initialState: {
                                            active: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            visible: boolean;
                                        };
                                        /** @enum {string} */
                                        type: "audio";
                                    })[];
                                    id: string;
                                    steps: {
                                        cues: {
                                            actions: ({
                                                active: boolean;
                                                /** @enum {string} */
                                                kind: "setActive";
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setVisible";
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                                visible: boolean;
                                            } | {
                                                /** @enum {string} */
                                                kind: "setOpacity";
                                                opacity: number;
                                                targetElementId: string;
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setTransform";
                                                targetElementId: string;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                                transition?: {
                                                    delaySeconds: number;
                                                    durationSeconds: number;
                                                };
                                            })[];
                                            id: string;
                                            next: {
                                                /** @enum {string} */
                                                kind: "step";
                                                stepId: string;
                                            } | {
                                                groupId: string;
                                                /** @enum {string} */
                                                kind: "group";
                                            } | {
                                                /** @enum {string} */
                                                kind: "end";
                                            };
                                            trigger: {
                                                action: string;
                                                /** @enum {string} */
                                                kind: "button";
                                            } | {
                                                /** @enum {string} */
                                                kind: "enterZone";
                                                zoneId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "motion";
                                                minimumDistanceMeters: number;
                                            };
                                        }[];
                                        id: string;
                                    }[];
                                }[];
                                metadata: {
                                    description?: string;
                                    title: string;
                                };
                                /** @enum {number} */
                                schemaVersion: 1;
                                stage: {
                                    coordinateSystem: {
                                        /** @enum {string} */
                                        forwardAxis: "-Z";
                                        /** @enum {string} */
                                        handedness: "right";
                                        /** @enum {string} */
                                        unit: "meter";
                                        /** @enum {string} */
                                        upAxis: "+Y";
                                    };
                                    size: number[];
                                    zones: {
                                        bounds: {
                                            max: number[];
                                            min: number[];
                                        };
                                        id: string;
                                    }[];
                                };
                            };
                            id: string;
                            revision: number;
                            updatedAt: string;
                        };
                    };
                };
                /** @description Invalid presentation update */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Revision conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Asset reference is not ready or does not belong to this presentation */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        expectedRevision: number;
                    };
                };
            };
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid delete request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Revision conflict or presentation assets must be deleted first */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                        name: string;
                        presentationId: string;
                        sha256Hex: string;
                        sizeBytes: number;
                    };
                };
            };
            responses: {
                /** @description Upload initialized */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            asset: {
                                createdAt: string;
                                id: string;
                                /** @enum {string} */
                                mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                                name: string;
                                presentationId: string;
                                sha256Hex: string;
                                sizeBytes: number;
                                /** @enum {string} */
                                status: "pending" | "ready" | "failed" | "deleting";
                                updatedAt: string;
                            };
                            upload: {
                                expiresAt: string;
                                headers: {
                                    "content-length": string;
                                    /** @enum {string} */
                                    "content-type": "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                                    "x-amz-checksum-sha256": string;
                                };
                                /** @enum {string} */
                                method: "PUT";
                                /** Format: uri */
                                url: string;
                            };
                        };
                    };
                };
                /** @description Invalid upload */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Signing unavailable */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Asset */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            id: string;
                            /** @enum {string} */
                            mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                            name: string;
                            presentationId: string;
                            sha256Hex: string;
                            sizeBytes: number;
                            /** @enum {string} */
                            status: "pending" | "ready" | "failed" | "deleting";
                            updatedAt: string;
                        };
                    };
                };
                /** @description Invalid asset id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid asset id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Referenced */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{id}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Finalized */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            id: string;
                            /** @enum {string} */
                            mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                            name: string;
                            presentationId: string;
                            sha256Hex: string;
                            sizeBytes: number;
                            /** @enum {string} */
                            status: "pending" | "ready" | "failed" | "deleting";
                            updatedAt: string;
                        };
                    };
                };
                /** @description Invalid asset id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Verification failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assets/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Download access */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            download: {
                                expiresAt: string;
                                /** @enum {string} */
                                method: "GET";
                                /** Format: uri */
                                url: string;
                            };
                        };
                    };
                };
                /** @description Invalid asset id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Access unavailable */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        presentationId: string;
                    };
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            joinCode: string;
                            session: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                endedAt: string | null;
                                id: string;
                                /** @enum {number} */
                                maxParticipants: 50;
                                participantCount: number;
                                presentationId: string;
                                presenterId: string;
                                /** @enum {string} */
                                state: "Waiting" | "Presenting" | "Ended";
                            };
                        };
                    };
                };
                /** @description Invalid session */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Presentation not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/join": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        joinCode: string;
                    };
                };
            };
            responses: {
                /** @description Joined */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
                            id: string;
                            /** @enum {number} */
                            maxParticipants: 50;
                            participantCount: number;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                        };
                    };
                };
                /** @description Invalid join code */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Session full */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Rate limited */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Session */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
                            id: string;
                            /** @enum {number} */
                            maxParticipants: 50;
                            participantCount: number;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                        };
                    };
                };
                /** @description Invalid id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Presenting */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
                            id: string;
                            /** @enum {number} */
                            maxParticipants: 50;
                            participantCount: number;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                        };
                    };
                };
                /** @description Invalid id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Invalid transition */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Ended */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
                            id: string;
                            /** @enum {number} */
                            maxParticipants: 50;
                            participantCount: number;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                        };
                    };
                };
                /** @description Invalid id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Invalid transition */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{id}/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Realtime connection */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            assignmentEpoch: number;
                            credential: string;
                            /** Format: uri */
                            endpoint: string;
                            /** Format: date-time */
                            expiresAt: string;
                            fingerprint: string | null;
                            presentationId: string;
                            presentationRevision: number;
                            runtimeId: string;
                            /** @enum {string} */
                            runtimeKind: "Cloud" | "VenueEdge";
                        };
                    };
                };
                /** @description Invalid id */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Session ended */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sessions/{sessionId}/runtime-assignment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    sessionId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Active assignment */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            assignmentEpoch: number;
                            certificateFingerprint: string | null;
                            /** Format: uri */
                            endpoint: string;
                            /** Format: date-time */
                            issuedAt: string;
                            /** Format: date-time */
                            leaseExpiresAt: string;
                            presentationRevision: number;
                            provisioningEdgeId: string | null;
                            /** Format: date-time */
                            releasedAt: string | null;
                            runtimeId: string;
                            /** @enum {string} */
                            runtimeKind: "Cloud" | "VenueEdge";
                            sessionId: string;
                        };
                    };
                };
                /** @description Invalid session ID */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description No active assignment */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    sessionId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uri */
                        endpoint?: string;
                        /** Format: date-time */
                        leaseExpiresAt: string;
                        presentationRevision: number;
                        runtimeId: string;
                        /** @enum {string} */
                        runtimeKind: "Cloud" | "VenueEdge";
                    };
                };
            };
            responses: {
                /** @description Assigned */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            assignmentEpoch: number;
                            certificateFingerprint: string | null;
                            /** Format: uri */
                            endpoint: string;
                            /** Format: date-time */
                            issuedAt: string;
                            /** Format: date-time */
                            leaseExpiresAt: string;
                            presentationRevision: number;
                            provisioningEdgeId: string | null;
                            /** Format: date-time */
                            releasedAt: string | null;
                            runtimeId: string;
                            /** @enum {string} */
                            runtimeKind: "Cloud" | "VenueEdge";
                            sessionId: string;
                        };
                    };
                };
                /** @description Invalid assignment request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Active assignment exists */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/venue-edges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date-time */
                        expiresAt: string;
                    };
                };
            };
            responses: {
                /** @description Provisioned */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            edge: {
                                id: string;
                                /** @enum {string} */
                                status: "active" | "revoked";
                            };
                            token: string;
                        };
                    };
                };
                /** @description Invalid provisioning request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Invalid credential expiry */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/venue-edges/{edgeId}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    edgeId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date-time */
                        expiresAt: string;
                        /** Format: date-time */
                        overlapExpiresAt: string;
                    };
                };
            };
            responses: {
                /** @description Rotated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            token: string;
                            tokenId: string;
                        };
                    };
                };
                /** @description Invalid rotation request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Invalid credential expiry */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/venue-edges/{edgeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    edgeId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid Edge ID */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/venue-edges/{edgeId}/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    edgeId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        capacity: number;
                        certificateFingerprint: string;
                        health: string;
                        /** Format: uri */
                        localEndpoint: string;
                        /** @enum {string} */
                        protocolVersion: "v1";
                        runtimeId: string;
                        runtimeVersion: string;
                    };
                };
            };
            responses: {
                /** @description Registered */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid registration */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Runtime identity conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/renew": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    assignmentEpoch: number;
                    edgeId: string;
                    sessionId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date-time */
                        leaseExpiresAt: string;
                    };
                };
            };
            responses: {
                /** @description Renewed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            assignmentEpoch: number;
                            certificateFingerprint: string | null;
                            /** Format: uri */
                            endpoint: string;
                            /** Format: date-time */
                            issuedAt: string;
                            /** Format: date-time */
                            leaseExpiresAt: string;
                            presentationRevision: number;
                            provisioningEdgeId: string | null;
                            /** Format: date-time */
                            releasedAt: string | null;
                            runtimeId: string;
                            /** @enum {string} */
                            runtimeKind: "Cloud" | "VenueEdge";
                            sessionId: string;
                        };
                    };
                };
                /** @description Invalid lease renewal */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Invalid lease */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/venue-edges/{edgeId}/assignments/{sessionId}/{assignmentEpoch}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    assignmentEpoch: number;
                    edgeId: string;
                    sessionId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Released */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid lease release */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Invalid lease */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/callbacks/checkpoints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sessionId: string;
                        assignmentEpoch: number;
                        presentationRevision: number;
                        runtimeId: string;
                        /** @enum {string} */
                        runtimeKind: "Cloud" | "VenueEdge";
                        idempotencyKey: string;
                        lastSequence: number;
                        payload: unknown | boolean | number | string | unknown[] | {
                            [key: string]: unknown;
                        };
                        version: number;
                    };
                };
            };
            responses: {
                /** @description Persistence result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            applied: boolean;
                        };
                    };
                };
                /** @description Invalid callback */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Session not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Runtime assignment is not active */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/callbacks/completions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sessionId: string;
                        assignmentEpoch: number;
                        presentationRevision: number;
                        runtimeId: string;
                        /** @enum {string} */
                        runtimeKind: "Cloud" | "VenueEdge";
                        checkpointVersion: number;
                        /** Format: date-time */
                        endedAt: string;
                        finalCheckpoint: unknown | boolean | number | string | unknown[] | {
                            [key: string]: unknown;
                        };
                        idempotencyKey: string;
                        lastSequence: number;
                        participantCount: number;
                        participants: {
                            /** @enum {string} */
                            role: "presenter" | "viewer";
                            userId: string;
                        }[];
                        /** Format: date-time */
                        startedAt: string;
                    };
                };
            };
            responses: {
                /** @description Persistence result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            applied: boolean;
                        };
                    };
                };
                /** @description Invalid callback */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Session not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
                /** @description Runtime assignment is not active */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: {
                                code: string;
                                message: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/.well-known/jwks.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Realtime signing keys */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            keys: {
                                /** @enum {string} */
                                alg: "EdDSA";
                                /** @enum {string} */
                                crv: "Ed25519";
                                key_ops: "verify"[];
                                kid: string;
                                /** @enum {string} */
                                kty: "OKP";
                                /** @enum {string} */
                                use: "sig";
                                x: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

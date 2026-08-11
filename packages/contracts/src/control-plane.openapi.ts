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
                                id: string;
                                revision: number;
                                /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                                definition: {
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    metadata: {
                                        title: string;
                                        description?: string;
                                    };
                                    stage: {
                                        coordinateSystem: {
                                            /** @enum {string} */
                                            unit: "meter";
                                            /** @enum {string} */
                                            handedness: "right";
                                            /** @enum {string} */
                                            upAxis: "+Y";
                                            /** @enum {string} */
                                            forwardAxis: "-Z";
                                        };
                                        size: number[];
                                        zones: {
                                            id: string;
                                            bounds: {
                                                min: number[];
                                                max: number[];
                                            };
                                        }[];
                                    };
                                    assets: {
                                        assetId: string;
                                    }[];
                                    groups: {
                                        id: string;
                                        elements: ({
                                            id: string;
                                            /** @enum {string} */
                                            type: "text";
                                            content: {
                                                text: string;
                                            };
                                            initialState: {
                                                active: boolean;
                                                visible: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                            };
                                        } | {
                                            id: string;
                                            /** @enum {string} */
                                            type: "shape";
                                            content: {
                                                /** @enum {string} */
                                                shape: "cube" | "sphere" | "plane";
                                            };
                                            initialState: {
                                                active: boolean;
                                                visible: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                            };
                                        } | {
                                            id: string;
                                            /** @enum {string} */
                                            type: "image";
                                            content: {
                                                assetId: string;
                                            };
                                            initialState: {
                                                active: boolean;
                                                visible: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                            };
                                        } | {
                                            id: string;
                                            /** @enum {string} */
                                            type: "video";
                                            content: {
                                                assetId: string;
                                            };
                                            initialState: {
                                                active: boolean;
                                                visible: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                            };
                                        } | {
                                            id: string;
                                            /** @enum {string} */
                                            type: "model";
                                            content: {
                                                assetId: string;
                                            };
                                            initialState: {
                                                active: boolean;
                                                visible: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                            };
                                        } | {
                                            id: string;
                                            /** @enum {string} */
                                            type: "audio";
                                            content: {
                                                assetId: string;
                                            };
                                            initialState: {
                                                active: boolean;
                                                visible: boolean;
                                                opacity: number;
                                                transform: {
                                                    position: number[];
                                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                    rotation: number[];
                                                    scale: number[];
                                                };
                                            };
                                        })[];
                                        anchoredElementGroups: {
                                            id: string;
                                            /** @enum {string} */
                                            anchor: "head" | "leftHand" | "rightHand" | "body";
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                            elementIds: string[];
                                        }[];
                                        steps: {
                                            id: string;
                                            cues: {
                                                id: string;
                                                trigger: {
                                                    /** @enum {string} */
                                                    kind: "button";
                                                    action: string;
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "enterZone";
                                                    zoneId: string;
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "motion";
                                                    minimumDistanceMeters: number;
                                                };
                                                actions: ({
                                                    /** @enum {string} */
                                                    kind: "setActive";
                                                    targetElementId: string;
                                                    active: boolean;
                                                    transition?: {
                                                        durationSeconds: number;
                                                        delaySeconds: number;
                                                    };
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "setVisible";
                                                    targetElementId: string;
                                                    visible: boolean;
                                                    transition?: {
                                                        durationSeconds: number;
                                                        delaySeconds: number;
                                                    };
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "setOpacity";
                                                    targetElementId: string;
                                                    opacity: number;
                                                    transition?: {
                                                        durationSeconds: number;
                                                        delaySeconds: number;
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
                                                        durationSeconds: number;
                                                        delaySeconds: number;
                                                    };
                                                })[];
                                                next: {
                                                    /** @enum {string} */
                                                    kind: "step";
                                                    stepId: string;
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "group";
                                                    groupId: string;
                                                } | {
                                                    /** @enum {string} */
                                                    kind: "end";
                                                };
                                            }[];
                                        }[];
                                    }[];
                                };
                                createdAt: string;
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
            requestBody?: {
                content: {
                    "application/json": {
                        /** @enum {number} */
                        schemaVersion: 1;
                        metadata: {
                            title: string;
                            description?: string;
                        };
                        stage: {
                            coordinateSystem: {
                                /** @enum {string} */
                                unit: "meter";
                                /** @enum {string} */
                                handedness: "right";
                                /** @enum {string} */
                                upAxis: "+Y";
                                /** @enum {string} */
                                forwardAxis: "-Z";
                            };
                            size: number[];
                            zones: {
                                id: string;
                                bounds: {
                                    min: number[];
                                    max: number[];
                                };
                            }[];
                        };
                        assets: {
                            assetId: string;
                        }[];
                        groups: {
                            id: string;
                            elements: ({
                                id: string;
                                /** @enum {string} */
                                type: "text";
                                content: {
                                    text: string;
                                };
                                initialState: {
                                    active: boolean;
                                    visible: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                };
                            } | {
                                id: string;
                                /** @enum {string} */
                                type: "shape";
                                content: {
                                    /** @enum {string} */
                                    shape: "cube" | "sphere" | "plane";
                                };
                                initialState: {
                                    active: boolean;
                                    visible: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                };
                            } | {
                                id: string;
                                /** @enum {string} */
                                type: "image";
                                content: {
                                    assetId: string;
                                };
                                initialState: {
                                    active: boolean;
                                    visible: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                };
                            } | {
                                id: string;
                                /** @enum {string} */
                                type: "video";
                                content: {
                                    assetId: string;
                                };
                                initialState: {
                                    active: boolean;
                                    visible: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                };
                            } | {
                                id: string;
                                /** @enum {string} */
                                type: "model";
                                content: {
                                    assetId: string;
                                };
                                initialState: {
                                    active: boolean;
                                    visible: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                };
                            } | {
                                id: string;
                                /** @enum {string} */
                                type: "audio";
                                content: {
                                    assetId: string;
                                };
                                initialState: {
                                    active: boolean;
                                    visible: boolean;
                                    opacity: number;
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                };
                            })[];
                            anchoredElementGroups: {
                                id: string;
                                /** @enum {string} */
                                anchor: "head" | "leftHand" | "rightHand" | "body";
                                transform: {
                                    position: number[];
                                    /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                    rotation: number[];
                                    scale: number[];
                                };
                                elementIds: string[];
                            }[];
                            steps: {
                                id: string;
                                cues: {
                                    id: string;
                                    trigger: {
                                        /** @enum {string} */
                                        kind: "button";
                                        action: string;
                                    } | {
                                        /** @enum {string} */
                                        kind: "enterZone";
                                        zoneId: string;
                                    } | {
                                        /** @enum {string} */
                                        kind: "motion";
                                        minimumDistanceMeters: number;
                                    };
                                    actions: ({
                                        /** @enum {string} */
                                        kind: "setActive";
                                        targetElementId: string;
                                        active: boolean;
                                        transition?: {
                                            durationSeconds: number;
                                            delaySeconds: number;
                                        };
                                    } | {
                                        /** @enum {string} */
                                        kind: "setVisible";
                                        targetElementId: string;
                                        visible: boolean;
                                        transition?: {
                                            durationSeconds: number;
                                            delaySeconds: number;
                                        };
                                    } | {
                                        /** @enum {string} */
                                        kind: "setOpacity";
                                        targetElementId: string;
                                        opacity: number;
                                        transition?: {
                                            durationSeconds: number;
                                            delaySeconds: number;
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
                                            durationSeconds: number;
                                            delaySeconds: number;
                                        };
                                    })[];
                                    next: {
                                        /** @enum {string} */
                                        kind: "step";
                                        stepId: string;
                                    } | {
                                        /** @enum {string} */
                                        kind: "group";
                                        groupId: string;
                                    } | {
                                        /** @enum {string} */
                                        kind: "end";
                                    };
                                }[];
                            }[];
                        }[];
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
                            id: string;
                            revision: number;
                            /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                            definition: {
                                /** @enum {number} */
                                schemaVersion: 1;
                                metadata: {
                                    title: string;
                                    description?: string;
                                };
                                stage: {
                                    coordinateSystem: {
                                        /** @enum {string} */
                                        unit: "meter";
                                        /** @enum {string} */
                                        handedness: "right";
                                        /** @enum {string} */
                                        upAxis: "+Y";
                                        /** @enum {string} */
                                        forwardAxis: "-Z";
                                    };
                                    size: number[];
                                    zones: {
                                        id: string;
                                        bounds: {
                                            min: number[];
                                            max: number[];
                                        };
                                    }[];
                                };
                                assets: {
                                    assetId: string;
                                }[];
                                groups: {
                                    id: string;
                                    elements: ({
                                        id: string;
                                        /** @enum {string} */
                                        type: "text";
                                        content: {
                                            text: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "shape";
                                        content: {
                                            /** @enum {string} */
                                            shape: "cube" | "sphere" | "plane";
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "image";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "video";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "model";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "audio";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    })[];
                                    anchoredElementGroups: {
                                        id: string;
                                        /** @enum {string} */
                                        anchor: "head" | "leftHand" | "rightHand" | "body";
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        elementIds: string[];
                                    }[];
                                    steps: {
                                        id: string;
                                        cues: {
                                            id: string;
                                            trigger: {
                                                /** @enum {string} */
                                                kind: "button";
                                                action: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "enterZone";
                                                zoneId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "motion";
                                                minimumDistanceMeters: number;
                                            };
                                            actions: ({
                                                /** @enum {string} */
                                                kind: "setActive";
                                                targetElementId: string;
                                                active: boolean;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setVisible";
                                                targetElementId: string;
                                                visible: boolean;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setOpacity";
                                                targetElementId: string;
                                                opacity: number;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
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
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            })[];
                                            next: {
                                                /** @enum {string} */
                                                kind: "step";
                                                stepId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "group";
                                                groupId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "end";
                                            };
                                        }[];
                                    }[];
                                }[];
                            };
                            createdAt: string;
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
                            id: string;
                            revision: number;
                            /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                            definition: {
                                /** @enum {number} */
                                schemaVersion: 1;
                                metadata: {
                                    title: string;
                                    description?: string;
                                };
                                stage: {
                                    coordinateSystem: {
                                        /** @enum {string} */
                                        unit: "meter";
                                        /** @enum {string} */
                                        handedness: "right";
                                        /** @enum {string} */
                                        upAxis: "+Y";
                                        /** @enum {string} */
                                        forwardAxis: "-Z";
                                    };
                                    size: number[];
                                    zones: {
                                        id: string;
                                        bounds: {
                                            min: number[];
                                            max: number[];
                                        };
                                    }[];
                                };
                                assets: {
                                    assetId: string;
                                }[];
                                groups: {
                                    id: string;
                                    elements: ({
                                        id: string;
                                        /** @enum {string} */
                                        type: "text";
                                        content: {
                                            text: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "shape";
                                        content: {
                                            /** @enum {string} */
                                            shape: "cube" | "sphere" | "plane";
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "image";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "video";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "model";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "audio";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    })[];
                                    anchoredElementGroups: {
                                        id: string;
                                        /** @enum {string} */
                                        anchor: "head" | "leftHand" | "rightHand" | "body";
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        elementIds: string[];
                                    }[];
                                    steps: {
                                        id: string;
                                        cues: {
                                            id: string;
                                            trigger: {
                                                /** @enum {string} */
                                                kind: "button";
                                                action: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "enterZone";
                                                zoneId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "motion";
                                                minimumDistanceMeters: number;
                                            };
                                            actions: ({
                                                /** @enum {string} */
                                                kind: "setActive";
                                                targetElementId: string;
                                                active: boolean;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setVisible";
                                                targetElementId: string;
                                                visible: boolean;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setOpacity";
                                                targetElementId: string;
                                                opacity: number;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
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
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            })[];
                                            next: {
                                                /** @enum {string} */
                                                kind: "step";
                                                stepId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "group";
                                                groupId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "end";
                                            };
                                        }[];
                                    }[];
                                }[];
                            };
                            createdAt: string;
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
            requestBody?: {
                content: {
                    "application/json": {
                        expectedRevision: number;
                        /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                        definition: {
                            /** @enum {number} */
                            schemaVersion: 1;
                            metadata: {
                                title: string;
                                description?: string;
                            };
                            stage: {
                                coordinateSystem: {
                                    /** @enum {string} */
                                    unit: "meter";
                                    /** @enum {string} */
                                    handedness: "right";
                                    /** @enum {string} */
                                    upAxis: "+Y";
                                    /** @enum {string} */
                                    forwardAxis: "-Z";
                                };
                                size: number[];
                                zones: {
                                    id: string;
                                    bounds: {
                                        min: number[];
                                        max: number[];
                                    };
                                }[];
                            };
                            assets: {
                                assetId: string;
                            }[];
                            groups: {
                                id: string;
                                elements: ({
                                    id: string;
                                    /** @enum {string} */
                                    type: "text";
                                    content: {
                                        text: string;
                                    };
                                    initialState: {
                                        active: boolean;
                                        visible: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    };
                                } | {
                                    id: string;
                                    /** @enum {string} */
                                    type: "shape";
                                    content: {
                                        /** @enum {string} */
                                        shape: "cube" | "sphere" | "plane";
                                    };
                                    initialState: {
                                        active: boolean;
                                        visible: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    };
                                } | {
                                    id: string;
                                    /** @enum {string} */
                                    type: "image";
                                    content: {
                                        assetId: string;
                                    };
                                    initialState: {
                                        active: boolean;
                                        visible: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    };
                                } | {
                                    id: string;
                                    /** @enum {string} */
                                    type: "video";
                                    content: {
                                        assetId: string;
                                    };
                                    initialState: {
                                        active: boolean;
                                        visible: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    };
                                } | {
                                    id: string;
                                    /** @enum {string} */
                                    type: "model";
                                    content: {
                                        assetId: string;
                                    };
                                    initialState: {
                                        active: boolean;
                                        visible: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    };
                                } | {
                                    id: string;
                                    /** @enum {string} */
                                    type: "audio";
                                    content: {
                                        assetId: string;
                                    };
                                    initialState: {
                                        active: boolean;
                                        visible: boolean;
                                        opacity: number;
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                    };
                                })[];
                                anchoredElementGroups: {
                                    id: string;
                                    /** @enum {string} */
                                    anchor: "head" | "leftHand" | "rightHand" | "body";
                                    transform: {
                                        position: number[];
                                        /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                        rotation: number[];
                                        scale: number[];
                                    };
                                    elementIds: string[];
                                }[];
                                steps: {
                                    id: string;
                                    cues: {
                                        id: string;
                                        trigger: {
                                            /** @enum {string} */
                                            kind: "button";
                                            action: string;
                                        } | {
                                            /** @enum {string} */
                                            kind: "enterZone";
                                            zoneId: string;
                                        } | {
                                            /** @enum {string} */
                                            kind: "motion";
                                            minimumDistanceMeters: number;
                                        };
                                        actions: ({
                                            /** @enum {string} */
                                            kind: "setActive";
                                            targetElementId: string;
                                            active: boolean;
                                            transition?: {
                                                durationSeconds: number;
                                                delaySeconds: number;
                                            };
                                        } | {
                                            /** @enum {string} */
                                            kind: "setVisible";
                                            targetElementId: string;
                                            visible: boolean;
                                            transition?: {
                                                durationSeconds: number;
                                                delaySeconds: number;
                                            };
                                        } | {
                                            /** @enum {string} */
                                            kind: "setOpacity";
                                            targetElementId: string;
                                            opacity: number;
                                            transition?: {
                                                durationSeconds: number;
                                                delaySeconds: number;
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
                                                durationSeconds: number;
                                                delaySeconds: number;
                                            };
                                        })[];
                                        next: {
                                            /** @enum {string} */
                                            kind: "step";
                                            stepId: string;
                                        } | {
                                            /** @enum {string} */
                                            kind: "group";
                                            groupId: string;
                                        } | {
                                            /** @enum {string} */
                                            kind: "end";
                                        };
                                    }[];
                                }[];
                            }[];
                        };
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
                            id: string;
                            revision: number;
                            /** @description Atomic presentation definition. IDs are unique within their documented scope; all asset, zone, element, step, and group references must resolve. Step transitions cannot cross group boundaries. */
                            definition: {
                                /** @enum {number} */
                                schemaVersion: 1;
                                metadata: {
                                    title: string;
                                    description?: string;
                                };
                                stage: {
                                    coordinateSystem: {
                                        /** @enum {string} */
                                        unit: "meter";
                                        /** @enum {string} */
                                        handedness: "right";
                                        /** @enum {string} */
                                        upAxis: "+Y";
                                        /** @enum {string} */
                                        forwardAxis: "-Z";
                                    };
                                    size: number[];
                                    zones: {
                                        id: string;
                                        bounds: {
                                            min: number[];
                                            max: number[];
                                        };
                                    }[];
                                };
                                assets: {
                                    assetId: string;
                                }[];
                                groups: {
                                    id: string;
                                    elements: ({
                                        id: string;
                                        /** @enum {string} */
                                        type: "text";
                                        content: {
                                            text: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "shape";
                                        content: {
                                            /** @enum {string} */
                                            shape: "cube" | "sphere" | "plane";
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "image";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "video";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "model";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    } | {
                                        id: string;
                                        /** @enum {string} */
                                        type: "audio";
                                        content: {
                                            assetId: string;
                                        };
                                        initialState: {
                                            active: boolean;
                                            visible: boolean;
                                            opacity: number;
                                            transform: {
                                                position: number[];
                                                /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                                rotation: number[];
                                                scale: number[];
                                            };
                                        };
                                    })[];
                                    anchoredElementGroups: {
                                        id: string;
                                        /** @enum {string} */
                                        anchor: "head" | "leftHand" | "rightHand" | "body";
                                        transform: {
                                            position: number[];
                                            /** @description Normalized [x, y, z, w] quaternion; the server accepts a norm tolerance of 0.0001. */
                                            rotation: number[];
                                            scale: number[];
                                        };
                                        elementIds: string[];
                                    }[];
                                    steps: {
                                        id: string;
                                        cues: {
                                            id: string;
                                            trigger: {
                                                /** @enum {string} */
                                                kind: "button";
                                                action: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "enterZone";
                                                zoneId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "motion";
                                                minimumDistanceMeters: number;
                                            };
                                            actions: ({
                                                /** @enum {string} */
                                                kind: "setActive";
                                                targetElementId: string;
                                                active: boolean;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setVisible";
                                                targetElementId: string;
                                                visible: boolean;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            } | {
                                                /** @enum {string} */
                                                kind: "setOpacity";
                                                targetElementId: string;
                                                opacity: number;
                                                transition?: {
                                                    durationSeconds: number;
                                                    delaySeconds: number;
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
                                                    durationSeconds: number;
                                                    delaySeconds: number;
                                                };
                                            })[];
                                            next: {
                                                /** @enum {string} */
                                                kind: "step";
                                                stepId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "group";
                                                groupId: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "end";
                                            };
                                        }[];
                                    }[];
                                }[];
                            };
                            createdAt: string;
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
            requestBody?: {
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
            requestBody?: {
                content: {
                    "application/json": {
                        presentationId: string;
                        name: string;
                        /** @enum {string} */
                        mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                        sizeBytes: number;
                        sha256Hex: string;
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
                                id: string;
                                presentationId: string;
                                name: string;
                                /** @enum {string} */
                                mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                                sizeBytes: number;
                                sha256Hex: string;
                                /** @enum {string} */
                                status: "pending" | "ready" | "failed" | "deleting";
                                createdAt: string;
                                updatedAt: string;
                            };
                            upload: {
                                /** @enum {string} */
                                method: "PUT";
                                /** Format: uri */
                                url: string;
                                expiresAt: string;
                                headers: {
                                    /** @enum {string} */
                                    "content-type": "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                                    "content-length": string;
                                    "x-amz-checksum-sha256": string;
                                };
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
                            id: string;
                            presentationId: string;
                            name: string;
                            /** @enum {string} */
                            mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                            sizeBytes: number;
                            sha256Hex: string;
                            /** @enum {string} */
                            status: "pending" | "ready" | "failed" | "deleting";
                            createdAt: string;
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
                            id: string;
                            presentationId: string;
                            name: string;
                            /** @enum {string} */
                            mediaType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "audio/mpeg" | "model/gltf-binary";
                            sizeBytes: number;
                            sha256Hex: string;
                            /** @enum {string} */
                            status: "pending" | "ready" | "failed" | "deleting";
                            createdAt: string;
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
                                /** @enum {string} */
                                method: "GET";
                                /** Format: uri */
                                url: string;
                                expiresAt: string;
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
            requestBody?: {
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
                            session: {
                                id: string;
                                presentationId: string;
                                presenterId: string;
                                /** @enum {string} */
                                state: "Waiting" | "Presenting" | "Ended";
                                participantCount: number;
                                /** @enum {number} */
                                maxParticipants: 50;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                endedAt: string | null;
                            };
                            joinCode: string;
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
            requestBody?: {
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
                            id: string;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                            participantCount: number;
                            /** @enum {number} */
                            maxParticipants: 50;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
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
                            id: string;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                            participantCount: number;
                            /** @enum {number} */
                            maxParticipants: 50;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
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
                            id: string;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                            participantCount: number;
                            /** @enum {number} */
                            maxParticipants: 50;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
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
                            id: string;
                            presentationId: string;
                            presenterId: string;
                            /** @enum {string} */
                            state: "Waiting" | "Presenting" | "Ended";
                            participantCount: number;
                            /** @enum {number} */
                            maxParticipants: 50;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            endedAt: string | null;
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
                            /** Format: uri */
                            endpoint: string;
                            credential: string;
                            /** Format: date-time */
                            expiresAt: string;
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
                                kty: "OKP";
                                /** @enum {string} */
                                crv: "Ed25519";
                                x: string;
                                kid: string;
                                /** @enum {string} */
                                alg: "EdDSA";
                                /** @enum {string} */
                                use: "sig";
                                key_ops: "verify"[];
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
            requestBody?: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sessionId: string;
                        version: number;
                        lastSequence: number;
                        idempotencyKey: string;
                        payload: {
                            [key: string]: unknown;
                        };
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
            requestBody?: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        sessionId: string;
                        checkpointVersion: number;
                        lastSequence: number;
                        idempotencyKey: string;
                        /** Format: date-time */
                        startedAt: string;
                        /** Format: date-time */
                        endedAt: string;
                        participantCount: number;
                        participants: {
                            userId: string;
                            /** @enum {string} */
                            role: "presenter" | "viewer";
                        }[];
                        finalCheckpoint: {
                            [key: string]: unknown;
                        };
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
            };
        };
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

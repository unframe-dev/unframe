export const sdkFixtureSource = `
export const definePresentation = <T>(value: T): T => value;
export const defineTheme = <T>(value: T): T => value;
export const defineComponentManifest = <T>(value: T): T => value;
export const defineComponentStructure = <T>(value: T): T => value;
export const defineComponent = <T>(value: T): T => value;
export const editableText = (value: { required: true }) => ({ kind: "string" as const, ...value, editor: { kind: "text" as const } });
export const prop = (name: string) => ({ kind: "prop-ref" as const, name });
`;

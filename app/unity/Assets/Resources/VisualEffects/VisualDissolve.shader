Shader "Unframe/VisualEffects/Dissolve"
{
    Properties
    {
        _BaseMap("Base map", 2D) = "white" {}
        _BaseColor("Base color", Color) = (1,1,1,1)
        _EdgeColor("Edge color", Color) = (0,1,1,1)
        _Progress("Progress", Range(0,1)) = 0
        _NoiseScale("Noise scale", Float) = 12
        _Seed("Seed", Float) = 0
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Opaque" "Queue"="AlphaTest" }
        Pass
        {
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half4 _EdgeColor;
                float _Progress;
                float _NoiseScale;
                float _Seed;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionOS : TEXCOORD0; float2 uv : TEXCOORD1; half3 normalWS : TEXCOORD2; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.positionOS = input.positionOS.xyz;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                return output;
            }
            float Hash(float3 p) { return frac(sin(dot(p, float3(12.9898,78.233,37.719)) + _Seed) * 43758.5453); }
            float Noise(float3 p)
            {
                float3 i = floor(p), f = frac(p);
                f = f * f * (3 - 2 * f);
                return lerp(lerp(lerp(Hash(i), Hash(i+float3(1,0,0)), f.x), lerp(Hash(i+float3(0,1,0)), Hash(i+float3(1,1,0)), f.x), f.y),
                    lerp(lerp(Hash(i+float3(0,0,1)), Hash(i+float3(1,0,1)), f.x), lerp(Hash(i+float3(0,1,1)), Hash(i+float3(1,1,1)), f.x), f.y), f.z);
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float noise = Noise(input.positionOS * _NoiseScale);
                if (_Progress >= 1) discard;
                if (_Progress > 0) clip(noise - _Progress);
                half4 base = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;
                Light light = GetMainLight();
                half3 lighting = SampleSH(normalize(input.normalWS)) + light.color * saturate(dot(normalize(input.normalWS), light.direction));
                half edge = _Progress > 0 ? 1 - smoothstep(0, 0.06, noise - _Progress) : 0;
                return half4(base.rgb * lighting + _EdgeColor.rgb * edge * _EdgeColor.a, base.a);
            }
            ENDHLSL
        }
    }
}

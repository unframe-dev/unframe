Shader "Unframe/BakedSurface"
{
    Properties
    {
        _FromTex ("From Texture", 2D) = "white" {}
        _ToTex ("To Texture", 2D) = "white" {}
        _FromVisible ("From Visible", Range(0,1)) = 1
        _ToVisible ("To Visible", Range(0,1)) = 1
        _Blend ("Blend", Range(0,1)) = 0
        _Color ("Color", Color) = (1,1,1,1)
        _Opacity ("Opacity", Range(0,1)) = 1
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" "UniversalMaterialType"="Unlit" }
        Cull Off ZWrite Off Blend SrcAlpha OneMinusSrcAlpha
        Pass
        {
            Name "BakedSurface"
            Tags { "LightMode"="SRPDefaultUnlit" }
            HLSLPROGRAM
            #pragma target 2.0
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Input
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            struct Output
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };
            TEXTURE2D(_FromTex);
            SAMPLER(sampler_FromTex);
            TEXTURE2D(_ToTex);
            SAMPLER(sampler_ToTex);
            CBUFFER_START(UnityPerMaterial)
            float _FromVisible;
            float _ToVisible;
            float _Blend;
            half4 _Color;
            float _Opacity;
            CBUFFER_END
            Output vert(Input input)
            {
                Output output = (Output)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }
            half4 frag(Output input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                half4 from = SAMPLE_TEXTURE2D(_FromTex, sampler_FromTex, input.uv);
                half4 to = SAMPLE_TEXTURE2D(_ToTex, sampler_ToTex, input.uv);
                float fromAlpha = from.a * _FromVisible * (1 - _Blend);
                float toAlpha = to.a * _ToVisible * _Blend;
                float alpha = fromAlpha + toAlpha;
                float3 rgb = alpha > 0 ? (from.rgb * fromAlpha + to.rgb * toAlpha) / alpha : float3(0, 0, 0);
                return half4(rgb * _Color.rgb, alpha * _Opacity * _Color.a);
            }
            ENDHLSL
        }
    }
}

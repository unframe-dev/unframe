Shader "Unframe/PreviewUnlitTransparent"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _BlendTex ("Blend Texture", 2D) = "white" {}
        _BlendWeight ("Blend Weight", Range(0, 1)) = 0
        _Color ("Tint", Color) = (1, 1, 1, 1)
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Back
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
            };
            struct v2f
            {
                float4 vertex : SV_POSITION;
                float2 uv : TEXCOORD0;
            };
            sampler2D _MainTex;
            sampler2D _BlendTex;
            float _BlendWeight;
            fixed4 _Color;

            v2f vert(appdata input)
            {
                v2f output;
                output.vertex = UnityObjectToClipPos(input.vertex);
                output.uv = input.uv;
                return output;
            }
            fixed4 frag(v2f input) : SV_Target
            {
                fixed4 first = tex2D(_MainTex, input.uv);
                fixed4 second = tex2D(_BlendTex, input.uv);
                float alpha = lerp(first.a, second.a, _BlendWeight);
                float3 premultiplied = lerp(first.rgb * first.a, second.rgb * second.a, _BlendWeight);
                float3 rgb = alpha > 0 ? premultiplied / alpha : 0;
                return fixed4(rgb * _Color.rgb, alpha * _Color.a);
            }
            ENDCG
        }
    }
}

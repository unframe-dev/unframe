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
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        Cull Off ZWrite Off Blend SrcAlpha OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            struct Input { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct Output { float4 vertex : SV_POSITION; float2 uv : TEXCOORD0; };
            sampler2D _FromTex;
            sampler2D _ToTex;
            float _FromVisible;
            float _ToVisible;
            float _Blend;
            fixed4 _Color;
            float _Opacity;
            Output vert(Input input)
            {
                Output output;
                output.vertex = UnityObjectToClipPos(input.vertex);
                output.uv = input.uv;
                return output;
            }
            fixed4 frag(Output input) : SV_Target
            {
                fixed4 from = tex2D(_FromTex, input.uv);
                fixed4 to = tex2D(_ToTex, input.uv);
                float fromAlpha = from.a * _FromVisible * (1 - _Blend);
                float toAlpha = to.a * _ToVisible * _Blend;
                float alpha = fromAlpha + toAlpha;
                float3 rgb = alpha > 0 ? (from.rgb * fromAlpha + to.rgb * toAlpha) / alpha : float3(0, 0, 0);
                return fixed4(rgb * _Color.rgb, alpha * _Opacity * _Color.a);
            }
            ENDCG
        }
    }
}

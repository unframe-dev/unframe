import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";

type EmailLayoutProps = {
  title: string;
  preview: string;
  description: string;
  actionLabel: string;
  url: string;
};

export function EmailLayout({ title, preview, description, actionLabel, url }: EmailLayoutProps) {
  return (
    <Html lang="ja">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#f7f7f5",
          color: "#15171d",
          fontFamily: '"Helvetica Neue", Arial, "Noto Sans JP", sans-serif',
        }}
      >
        <Section style={{ padding: "40px 16px" }}>
          <Container style={{ maxWidth: "560px", margin: "0 auto" }}>
            <Section style={{ padding: "0 0 28px" }}>
              <Row>
                <Column style={{ width: "44px" }}>
                  <Img
                    src="https://un-fra.me/_app/immutable/assets/icon.CmnQ5457.svg"
                    alt=""
                    width="32"
                    height="32"
                  />
                </Column>
                <Column>
                  <Text
                    style={{
                      margin: 0,
                      fontSize: "26px",
                      lineHeight: "32px",
                      fontWeight: 400,
                      letterSpacing: "-1px",
                    }}
                  >
                    Unframe
                  </Text>
                </Column>
              </Row>
            </Section>
            <Section
              style={{ backgroundColor: "#ffffff", borderRadius: "20px", padding: "36px 28px" }}
            >
              <Heading
                as="h1"
                style={{
                  margin: "0 0 20px",
                  fontSize: "28px",
                  lineHeight: "40px",
                  fontWeight: 500,
                  letterSpacing: "-0.5px",
                }}
              >
                {title}
              </Heading>
              <Text
                style={{
                  margin: "0 0 28px",
                  fontSize: "15px",
                  lineHeight: "26px",
                  color: "#4f525a",
                }}
              >
                {description}
              </Text>
              <Button
                href={url}
                style={{
                  backgroundColor: "#df7b80",
                  color: "#15171d",
                  borderRadius: "999px",
                  padding: "14px 22px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {actionLabel}
              </Button>
            </Section>
            <Text
              style={{ margin: "24px 0 0", fontSize: "12px", lineHeight: "22px", color: "#696d76" }}
            >
              心当たりがない場合は、このメールを破棄してください。
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

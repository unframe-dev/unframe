import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください。"),
  password: z.string().min(8, "パスワードは8文字以上にしてください。"),
});
export type Credentials = z.infer<typeof credentialsSchema>;

import { createRoot } from "react-dom/client";
import { AuthorApp } from "./author-app";
import { createAuthorApi, takeAuthorToken } from "./api";

const token = takeAuthorToken();
const target = document.getElementById("root");
if (!target) {
  throw new Error("Author root is missing");
}
if (!token) {
  target.textContent = "Author token is missing or invalid.";
} else {
  createRoot(target).render(<AuthorApp api={createAuthorApi(token)} />);
}

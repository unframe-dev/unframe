import { RouterProvider } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppProviders } from "./app/providers/app-providers";
import { appRouter } from "./app/router/router";

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

function AppRouter() {
  const queryClient = useQueryClient();
  return <RouterProvider router={appRouter} context={{ queryClient }} />;
}

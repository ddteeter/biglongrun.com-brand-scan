import { Nav } from "./components/nav";

export interface LayoutProps {
  title: string;
  currentPath: string;
  // JSX.Element is string | Promise<string> from @kitajs/html; we accept both here.
  children: JSX.Element | JSX.Element[] | undefined;
}

export function Layout(props: Readonly<LayoutProps>): JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} — brand-scan</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
        <script src="https://unpkg.com/htmx.org@2"></script>
      </head>
      <body>
        <Nav current={props.currentPath} />
        <main class="container">{props.children}</main>
      </body>
    </html>
  );
}

export function renderHtml(node: JSX.Element): Response {
  // @kitajs/html JSX.Element is string | Promise<string>; at this call site
  // all Layout invocations are synchronous (no async children), so the cast
  // to string is safe. If async children are ever needed, await here instead.
  return new Response(`<!DOCTYPE html>${node as string}`, {
    headers: { "content-type": "text/html" },
  });
}

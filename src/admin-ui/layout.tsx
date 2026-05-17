import { Nav } from "./components/nav";

export interface LayoutProps {
  title: string;
  currentPath: string;
  children: string | string[] | undefined;
}

export function Layout(props: Readonly<LayoutProps>): string {
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
  ) as string;
}

export function renderHtml(node: string): Response {
  return new Response(`<!DOCTYPE html>${node}`, { headers: { "content-type": "text/html" } });
}

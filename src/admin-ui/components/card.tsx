export function Card(
  // JSX.Element is string | Promise<string> from @kitajs/html; children may be
  // either a bare string or a nested JSX element (e.g. <a>...</a>).
  props: Readonly<{ title: string; children: JSX.Element | JSX.Element[] | undefined }>
): JSX.Element {
  return (
    <article>
      <header>
        <h3 style="margin:0;">{props.title}</h3>
      </header>
      {props.children}
    </article>
  );
}

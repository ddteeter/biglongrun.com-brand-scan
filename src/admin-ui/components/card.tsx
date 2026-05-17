export function Card(
  props: Readonly<{ title: string; children: string | string[] | undefined }>
): string {
  return (
    <article>
      <header>
        <h3 style="margin:0;">{props.title}</h3>
      </header>
      {props.children}
    </article>
  ) as string;
}

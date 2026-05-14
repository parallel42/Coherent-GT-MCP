export function buildSetStyleExpression(options: {
  selector: string;
  styles: Record<string, string>;
}): string {
  return `(() => {
  const selector = ${JSON.stringify(options.selector)};
  const styles = ${JSON.stringify(options.styles)};
  const matches = document.querySelectorAll(selector);
  for (let i = 0; i < matches.length; i += 1) {
    const element = matches[i];
    for (const name in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, name)) {
        element.style.setProperty(name, styles[name]);
      }
    }
  }
  return { selector, matched: matches.length, appliedStyles: styles };
})()`;
}

export function buildGetDocumentExpression(options: {
  selector: string;
  includeText: boolean;
  maxDepth: number;
}): string {
  return `(() => {
  const selector = ${JSON.stringify(options.selector)};
  const includeText = ${JSON.stringify(options.includeText)};
  const maxDepth = ${JSON.stringify(options.maxDepth)};
  const root = selector === "document.documentElement" ? document.documentElement : document.querySelector(selector);
  if (!root) {
    return { selector, found: false };
  }

  function attributesToObject(attributes) {
    const output = {};
    for (let i = 0; i < attributes.length; i += 1) {
      output[attributes[i].name] = attributes[i].value;
    }
    return output;
  }

  function serializeElement(element, depth) {
    const rect = element.getBoundingClientRect();
    const node = {
      tagName: element.tagName,
      id: element.id || undefined,
      className: typeof element.className === "string" ? element.className : undefined,
      attributes: attributesToObject(element.attributes || []),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      text: includeText ? element.textContent : undefined,
      children: []
    };

    if (depth < maxDepth) {
      for (let i = 0; i < element.children.length; i += 1) {
        node.children.push(serializeElement(element.children[i], depth + 1));
      }
    }

    return node;
  }

  return { selector, found: true, document: serializeElement(root, 0) };
})()`;
}

export function buildQuerySelectorExpression(options: {
  selector: string;
  includeComputedStyle: boolean;
}): string {
  return `(() => {
  const selector = ${JSON.stringify(options.selector)};
  const includeComputedStyle = ${JSON.stringify(options.includeComputedStyle)};
  const matches = document.querySelectorAll(selector);
  const output = [];

  function attributesToObject(attributes) {
    const result = {};
    for (let i = 0; i < attributes.length; i += 1) {
      result[attributes[i].name] = attributes[i].value;
    }
    return result;
  }

  function computedStyleToObject(element) {
    const styles = getComputedStyle(element);
    const result = {};
    for (let i = 0; i < styles.length; i += 1) {
      const name = styles[i];
      result[name] = styles.getPropertyValue(name);
    }
    return result;
  }

  for (let i = 0; i < matches.length; i += 1) {
    const element = matches[i];
    const rect = element.getBoundingClientRect();
    const summary = {
      tagName: element.tagName,
      id: element.id || undefined,
      className: typeof element.className === "string" ? element.className : undefined,
      text: element.textContent,
      attributes: attributesToObject(element.attributes || []),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };

    if (includeComputedStyle) {
      summary.computedStyle = computedStyleToObject(element);
    }

    output.push(summary);
  }

  return { selector, count: matches.length, matches: output };
})()`;
}

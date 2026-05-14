export function buildClickExpression(selector: string): string {
  return `(() => {
  const selector = ${JSON.stringify(selector)};
  const element = document.querySelector(selector);
  if (!element) {
    return { selector, clicked: false, reason: "No element matched selector" };
  }

  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    buttons: 1
  };

  element.dispatchEvent(new MouseEvent("mouseover", eventInit));
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  eventInit.buttons = 0;
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  element.dispatchEvent(new MouseEvent("click", eventInit));
  return { selector, clicked: true, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
})()`;
}

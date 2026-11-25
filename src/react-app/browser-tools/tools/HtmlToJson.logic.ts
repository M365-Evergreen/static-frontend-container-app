export interface JsonNode {
  tag: string;
  attributes?: Record<string, string>;
  text?: string;
  children?: JsonNode[];
}

function elementToJson(element: Element): JsonNode {
  const node: JsonNode = {
    tag: element.tagName.toLowerCase(),
  };

  if (element.attributes.length > 0) {
    node.attributes = {};
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (attr) node.attributes[attr.name] = attr.value;
    }
  }

  const children: JsonNode[] = [];
  let directText = "";

  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const trimmed = child.textContent?.trim();
      if (trimmed) directText += (directText ? " " : "") + trimmed;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(elementToJson(child as Element));
    }
  });

  if (directText) node.text = directText;
  if (children.length > 0) node.children = children;

  return node;
}

export function convertHtmlToJson(htmlString: string): string {
  if (!htmlString.trim()) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const bodyChildren = Array.from(doc.body.children);

  if (bodyChildren.length === 0) {
    return JSON.stringify(
      { text: doc.body.textContent?.trim() || "" },
      null,
      2,
    );
  }

  const result =
    bodyChildren.length === 1
      ? elementToJson(bodyChildren[0]!)
      : bodyChildren.map(elementToJson);

  return JSON.stringify(result, null, 2);
}

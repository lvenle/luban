export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) el.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function svgIcon(viewBox, children, className = 'page-type-svg') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add(className);
  for (const child of children) svg.append(child);
  return svg;
}

export function svgLine(x1, y1, x2, y2) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  return line;
}

export function svgPath(d) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  return path;
}

export function uiIcon(name) {
  const icons = {
    assistant: [svgPath('M12 3.5l1.15 3.35L16.5 8l-3.35 1.15L12 12.5l-1.15-3.35L7.5 8l3.35-1.15L12 3.5Z'), svgPath('M6.5 11.5 7.2 13.3 9 14l-1.8.7-.7 1.8-.7-1.8L4 14l1.8-.7.7-1.8Z')],
    settings: [svgPath('M8.5 3.5h3l.45 1.65 1.45.6 1.5-.85 1.5 2.6-1.2 1.1v1.8l1.2 1.1-1.5 2.6-1.5-.85-1.45.6-.45 1.65h-3l-.45-1.65-1.45-.6-1.5.85-1.5-2.6 1.2-1.1V8.6L3.6 7.5l1.5-2.6 1.5.85 1.45-.6.45-1.65Z'), svgPath('M8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z')],
    add: [svgLine(10, 4, 10, 16), svgLine(4, 10, 16, 10)],
    upload: [svgPath('M10 14V4'), svgPath('M6.5 7.5 10 4l3.5 3.5'), svgPath('M4 15.5h12')],
    download: [svgPath('M10 4v10'), svgPath('M6.5 10.5 10 14l3.5-3.5'), svgPath('M4 15.5h12')],
    trash: [svgPath('M4.5 6h11'), svgPath('M8 6V4.5h4V6'), svgPath('M6 6l.6 9.5h6.8L14 6')],
    filter: [svgPath('M4 5h12l-4.8 5.5V15l-2.4 1v-5.5L4 5Z')],
    sort: [svgPath('M7 4v12'), svgPath('M4.5 6.5 7 4l2.5 2.5'), svgPath('M13 16V4'), svgPath('M10.5 13.5 13 16l2.5-2.5')],
    group: [svgPath('M5 5h10v3H5z'), svgPath('M5 12h10v3H5z'), svgLine(7, 8, 7, 12), svgLine(13, 8, 13, 12)],
    fields: [svgPath('M4.5 5h11v10h-11z'), svgLine(8, 5, 8, 15), svgLine(12, 5, 12, 15)],
    form: [svgPath('M5 4.5h10v11H5z'), svgLine(7, 8, 13, 8), svgLine(7, 11, 11, 11)],
    view: [svgPath('M4.5 5.5h11v9h-11z'), svgLine(4.5, 8.5, 15.5, 8.5), svgLine(8, 8.5, 8, 14.5)],
    close: [svgLine(5.5, 5.5, 14.5, 14.5), svgLine(14.5, 5.5, 5.5, 14.5)]
  };
  return svgIcon('0 0 20 20', icons[name] || icons.view, 'ui-icon');
}

export function buttonLabel(iconName, label) {
  return [
    h('span', { class: 'button-label-icon' }, [uiIcon(iconName)]),
    h('span', { class: 'button-label-text', text: label })
  ];
}

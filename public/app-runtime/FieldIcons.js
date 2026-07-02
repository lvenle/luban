/**
 * Field type icons. Returns a small SVG element for a given field type.
 * All paths are within 0-16 viewBox. Styling is applied inline to avoid CSS
 * specificity/namespace issues.
 */
import { svgPath, svgIcon } from '../common/dom.js';

const fieldSvg = {
  text:        ['M3 3h10v2.5H9.5v8.5h-3V5.5H3V3Z'],
  textarea:    ['M3 3h10v2.5H9.5v8.5h-3V5.5H3V3Z', 'M5.5 12.5h-2v1h9v-1h-2'],
  number:      ['M4.5 13l6-10', 'M2.5 8.5h8', 'M5.5 11.5h8'],
  autoNumber:  ['M3 4h2v8', 'M2 12h4', 'M9 5a2 2 0 1 1 4 0c0 2-4 3-4 6h4'],
  date:        ['M2 2h12v12H2Z', 'M2 6h12v3H2Z', 'M5.5 2v7', 'M10.5 2v7'],
  datetime:    ['M2 2h12v12H2Z', 'M2 6h12v3H2Z', 'M5.5 2v7', 'M10.5 2v7'],
  url:         ['M7.5 4.5a2.5 2.5 0 0 1 2.5-2.5H10a2.5 2.5 0 0 1 2.5 2.5v4.5a2.5 2.5 0 0 1-2.5 2.5H10a2.5 2.5 0 0 1-2.5-2.5', 'M5 8.5a2.5 2.5 0 0 1-2.5 2.5h-.5A2.5 2.5 0 0 1 0 8.5V4a2.5 2.5 0 0 1 2.5-2.5h.5A2.5 2.5 0 0 1 5 4'],
  select:      ['M2.5 2h11v9h-11Z', 'M4.5 11L8 14l3.5-3Z'],
  multiSelect: ['M2.5 3h11v2.5h-11Z', 'M2.5 7h11v2.5h-11Z', 'M2.5 11h11v2.5h-11Z'],
  boolean:     ['M2 2h12v12H2Z', 'M5.5 8.5l2 2.5 3-5'],
  relation:    ['M5 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z', 'M16 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'],
  image:       ['M1 1h14v14H1Z', 'M1 12l3.5-4.5 3 3 3-3L15 12'],
  file:        ['M4 1h7l4 4v9.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5Z', 'M11 1v4h4'],
  richText:    ['M2.5 3.5h11v2.5h-11Z', 'M2.5 7h8v2.5h-8Z', 'M2.5 10.5h11v2.5h-11Z'],
  formula:     ['M2.5 2h11v12h-11Z', 'M6.5 5l2 6', 'M4.5 6.5H6', 'M9.5 6.5h2', 'M4.5 9.5H6', 'M9.5 9.5h2'],
  ai:          ['M8 1.5l1.5 3.5L13 7l-3.5 1.5L8 12 6.5 8.5 3 7l3.5-1.5L8 1.5Z', 'M5 12.5h2l1 2-1 2H5l1-2H5Z'],
};

export function fieldIcon(type) {
  const dList = fieldSvg[type];
  if (!dList) return fieldIcon('text');
  const paths = dList.map((d) => {
    const el = svgPath(d);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.5');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    return el;
  });
  const svg = svgIcon('0 0 16 16', paths, 'field-type-icon');
  svg.style.display = 'block';
  return svg;
}

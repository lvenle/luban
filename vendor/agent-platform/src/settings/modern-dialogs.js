import {readFileSync} from 'node:fs';
export function withModernDialogs(html){
 const style=readFileSync(new URL('./modern-dialogs.css',import.meta.url),'utf8');
 const script=readFileSync(new URL('./modern-dialogs.client.js',import.meta.url),'utf8');
 const markup=`<style>${style}</style><script>${script}</script>`;
 return html.includes('</head>')?html.replace('</head>',markup+'</head>'):html.replace(/<script\b/i,markup+'<script');
}

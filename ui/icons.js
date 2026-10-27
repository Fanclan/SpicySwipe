(function(root){
 const paths={
  spark:'m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z',
  home:'M3 10 12 3l9 7v10H3V10Zm6 10v-7h6v7',
  message:'M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8ZM7 8h7M7 12h10',
  swipe:'M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2-3h6M9 12l2 2 4-4',
  activity:'M3 12h4l3-8 4 16 3-8h4',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  arrow:'M5 12h14m-6-6 6 6-6 6',external:'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  moon:'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  play:'m8 4 12 8-12 8V4Z',pause:'M8 4v16M16 4v16',stop:'M5 5h14v14H5z',
  refresh:'M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  copy:'M9 9h12v12H9zM15 9V3H3v12h6',send:'m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2',
  info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10v1',
  bolt:'m13 2-9 12h7l-1 8 10-13h-8l1-7Z',chevron:'m9 5 7 7-7 7',key:'M14 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0Zm1 3L3 22m3-3-3-3m6 0-3-3',
  leaf:'M20 3C6 2 2 9 5 16c6 7 15 0 15-13ZM5 20 16 8'
 };
 root.SSIcons=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.spark}"/></svg>`;
})(globalThis);

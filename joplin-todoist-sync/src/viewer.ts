// markdown-it content script. Hides a `todoist` query block in the rendered
// note and the Rich Text editor (SPEC.md section 8.1). Every other code
// block is left to Joplin.

import { isQueryInfo, renderQueryBlock } from './blockDisplay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- markdown-it is supplied by Joplin at runtime, with no type packages
export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
		plugin: (markdownIt: any) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
			const defaultRender = markdownIt.renderer.rules.fence || ((tokens: any[], idx: number, opts: any, _env: any, self: any) => self.renderToken(tokens, idx, opts));

			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
			markdownIt.renderer.rules.fence = (tokens: any[], idx: number, opts: any, env: any, self: any) => {
				const token = tokens[idx];
				const info = token.info ? markdownIt.utils.unescapeAll(token.info) : '';
				if (!isQueryInfo(info)) return defaultRender(tokens, idx, opts, env, self);
				return renderQueryBlock(token.markup, info, token.content);
			};
		},
		assets: () => [{ name: 'viewer.css' }],
	};
};

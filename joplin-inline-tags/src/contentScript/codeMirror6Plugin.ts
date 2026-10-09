// To avoid importing @codemirror packages directly, we import CodeMirror types, then
// later, require dynamically.
//
// This allows us to continue supporting older versions of Joplin that don't depend
// on @codemirror/ packages.
import type * as CodeMirrorAutocompleteType from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import type * as CodeMirrorLanguageType from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

import { PluginContext } from './types';
import { findMatchingTags, tagExists } from './matchTags';

const codeMirror6Plugin = (context: PluginContext, CodeMirror: any) => {
	const { autocompletion, insertCompletionText } = require('@codemirror/autocomplete') as typeof CodeMirrorAutocompleteType;
	const { syntaxTree } = require('@codemirror/language') as typeof CodeMirrorLanguageType;

	const isInCodeBlock = (state: EditorState, from: number, to: number) => {
		let inCodeBlock = false;

		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
					inCodeBlock = true;
				}

				// Skip all nodes if already known to be in a code block
				// (false => skip child nodes).
				return !inCodeBlock;
			}
		});

		return inCodeBlock;
	};

	const completeMarkdown = async (completionContext: CompletionContext): Promise<CompletionResult> => {
		const prefix = completionContext.matchBefore(/[#][^ \n\t#]*/);
		if (!prefix) {
			return null;
		}

		if (isInCodeBlock(completionContext.state, prefix.from, prefix.to)) {
			return null;
		}

		const { tags, keepText } = await context.postMessage({
			command: 'getTags',
		});

		const searchText = prefix.text.substring(1);
		const matchingTags = findMatchingTags(tags, searchText);

		const completions: Completion[] = [];
		// Completion -> range of its label to highlight as the matched text
		const matchedRanges = new Map<Completion, number[]>();
		for (const { tag, index } of matchingTags) {
			const completion: Completion = {
				label: tag.title,
				apply: async (view, completion, from, to) => {
					context.postMessage({
						command: 'setTag',
						tag,
					});

					if (!!keepText) {
						view.dispatch(insertCompletionText(
							view.state,
							`#${completion.label}`,
							from,
							to,
						));
					} else {
						view.dispatch(insertCompletionText(
							view.state,
							'',
							from,
							to,
						));
					}
				}
			};
			completions.push(completion);
			if (searchText.length > 0) {
				matchedRanges.set(completion, [index, index + searchText.length]);
			}
		}

		if (searchText.length > 0) {
			if (!tagExists(tags, searchText)) {
				completions.push({
					label: `Create new tag: ${searchText}`,
					apply: (view, _completion, from, to) => {
						context.postMessage({
							command: 'newTag',
							name: searchText,
						});

						let completionText = `#${searchText}`;
						if (!keepText) {
							completionText = '';
						}

						// insertCompletionText also closes the completion dialog
						view.dispatch(insertCompletionText(
							view.state,
							completionText,
							from,
							to,
						));
					}
				});
			}
		}

		return {
			from: prefix.from,
			options: completions,
			filter: false,
			getMatch: (completion) => matchedRanges.get(completion) ?? [],
		};
	};

	CodeMirror.addExtension([
		CodeMirror.joplinExtensions.completionSource(completeMarkdown),

		autocompletion({
			tooltipClass: () => 'inline-tags-completions',
		}),
	]);
};

export default codeMirror6Plugin;
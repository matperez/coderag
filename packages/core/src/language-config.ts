/**
 * Language configuration (extension to language mapping).
 * AST chunking is done by code-chunk for typescript, javascript, python, rust, go, java.
 * Other extensions are used for display and fallback chunking.
 */

/**
 * Embedded language configuration (kept for API compatibility; unused after Synth removal)
 */
export interface EmbeddedLanguageConfig {
	readonly nodeType: string
	readonly langAttr?: string
	readonly defaultLanguage?: string
	readonly recursive?: boolean
}

/**
 * Minimal language config (extensions only)
 */
export interface LanguageConfig {
	readonly extensions: readonly string[]
}

/**
 * Language Registry
 * Maps language identifiers to extensions. Used for getLanguageFromPath and display.
 */
export const LANGUAGE_REGISTRY: Record<string, LanguageConfig> = {
	typescript: { extensions: ['.ts', '.tsx', '.mts', '.cts'] },
	javascript: { extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
	python: { extensions: ['.py', '.pyi', '.pyw'] },
	rust: { extensions: ['.rs'] },
	go: { extensions: ['.go'] },
	java: { extensions: ['.java'] },
	markdown: { extensions: ['.md', '.markdown', '.mdx'] },
	html: { extensions: ['.html', '.htm'] },
	json: { extensions: ['.json', '.jsonc', '.json5'] },
	yaml: { extensions: ['.yaml', '.yml'] },
	toml: { extensions: ['.toml'] },
	xml: { extensions: ['.xml', '.xsl', '.xslt', '.xsd', '.svg'] },
	ini: { extensions: ['.ini', '.cfg', '.conf', '.gitconfig', '.editorconfig'] },
	c: { extensions: ['.c', '.h'] },
	protobuf: { extensions: ['.proto'] },
}

/**
 * Extension to language mapping
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = Object.entries(
	LANGUAGE_REGISTRY
).reduce(
	(acc, [lang, config]) => {
		for (const ext of config.extensions) {
			acc[ext] = lang
		}
		return acc
	},
	{} as Record<string, string>
)

/**
 * Get language config by language name
 */
export function getLanguageConfig(language: string): LanguageConfig | undefined {
	return LANGUAGE_REGISTRY[language.toLowerCase()]
}

/**
 * Get language config by file extension
 */
export function getLanguageConfigByExtension(extension: string): LanguageConfig | undefined {
	const ext = extension.startsWith('.') ? extension : `.${extension}`
	const language = EXTENSION_TO_LANGUAGE[ext.toLowerCase()]
	return language ? LANGUAGE_REGISTRY[language] : undefined
}

/**
 * Get language name from file path
 */
export function getLanguageFromPath(filePath: string): string | undefined {
	const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
	return EXTENSION_TO_LANGUAGE[ext]
}

/**
 * Check if a language is supported (has extension mapping)
 */
export function isLanguageSupported(language: string): boolean {
	return language.toLowerCase() in LANGUAGE_REGISTRY
}

/**
 * Get all supported languages (registry keys)
 */
export function getSupportedLanguages(): string[] {
	return Object.keys(LANGUAGE_REGISTRY)
}

/**
 * Get all supported extensions
 */
export function getSupportedExtensions(): string[] {
	return Object.keys(EXTENSION_TO_LANGUAGE)
}

// Derived from @misskey-dev/oxlint-fmt-config (MIT)
import { defineConfig, type DummyRuleMap } from 'oxlint';

const jsRules: DummyRuleMap = {
	'eqeqeq': ['error', 'always', { null: 'ignore' }],
	'no-var': ['error'],
	'prefer-arrow-callback': ['error'],
	'no-throw-literal': ['error'],
	'no-param-reassign': ['warn'],
	'no-constant-condition': ['warn'],
	'no-empty-pattern': ['warn'],
	'no-async-promise-executor': ['error'],
	'no-useless-escape': ['off'],
	'no-control-regex': ['warn'],
	'no-empty': ['warn'],
	'no-inner-declarations': ['off'],
	'no-sparse-arrays': ['off'],
	// 1行の if / else / for / while / do は書かず、必ず {} のブロックにして本体を次の行に書く。
	// return / continue / throw などで処理が途切れる位置を、行の左側だけを見て追えるようにするため。
	'curly': ['error', 'all'],
};

const tsRules: DummyRuleMap = {
	'typescript/no-explicit-any': ['warn'],
	'no-unused-vars': ['warn'],
	'typescript/no-unnecessary-condition': ['warn'],
	'typescript/no-require-imports': ['warn', { allowAsImport: true }],
	'typescript/no-inferrable-types': ['warn'],
	'typescript/no-non-null-assertion': ['warn'],
	'typescript/explicit-function-return-type': ['off'],
	'typescript/no-misused-promises': ['warn', { checksVoidReturn: false }],
	'typescript/consistent-type-imports': 'off',
	'typescript/prefer-nullish-coalescing': ['warn'],
};

const stylisticRules: DummyRuleMap = {
	'@stylistic/array-bracket-spacing': ['error', 'never'],
	'@stylistic/arrow-spacing': ['error', { before: true, after: true }],
	'@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
	'@stylistic/comma-dangle': ['error', 'always-multiline'],
	'@stylistic/comma-spacing': ['error', { before: false, after: true }],
	'@stylistic/eol-last': ['error', 'always'],
	'@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
	'@stylistic/keyword-spacing': ['error', { before: true, after: true }],
	'@stylistic/indent': ['warn', 'tab', {
		SwitchCase: 1,
		MemberExpression: 1,
		flatTernaryExpressions: true,
		ArrayExpression: 'first',
		ObjectExpression: 'first',
	}],
	'@stylistic/lines-between-class-members': 'off',
	'@stylistic/no-multi-spaces': ['error'],
	'@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
	'@stylistic/object-curly-spacing': ['error', 'always'],
	'@stylistic/padded-blocks': ['error', 'never'],
	// 処理の区切りが見えるように空行を入れる。
	// 変数の宣言のまとまりの後と、return の前は必ず空ける（宣言が続く間は空けなくてよい）。
	'@stylistic/padding-line-between-statements': [
		'error',
		{ blankLine: 'always', prev: 'function', next: '*' },
		{ blankLine: 'always', prev: '*', next: 'function' },
		{ blankLine: 'always', prev: ['const', 'let'], next: '*' },
		{ blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
		{ blankLine: 'always', prev: '*', next: 'return' },
	],
	// ' を含む文字列は \' と書くより "..." のほうが読みやすいので、その場合だけ " を許す。
	'@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
	'@stylistic/semi': ['error', 'always'],
	'@stylistic/semi-spacing': ['error', { before: false, after: true }],
	'@stylistic/space-before-blocks': ['error', 'always'],
	'@stylistic/space-infix-ops': ['error'],
	'@stylistic/function-call-spacing': ['error', 'never'],
	'@stylistic/space-before-function-paren': ['error', {
		anonymous: 'always',
		named: 'never',
		asyncArrow: 'always',
	}],
};

export default defineConfig({
	jsPlugins: ['@stylistic/eslint-plugin'],
	options: {
		typeAware: true,
	},
	ignorePatterns: [
		'**/built',
		'**/node_modules',
	],
	overrides: [
		{
			files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
			rules: {
				...jsRules,
				...stylisticRules,
			},
		},
		{
			files: ['**/*.ts', '**/*.tsx'],
			rules: {
				...jsRules,
				...tsRules,
				...stylisticRules,
			},
		},
	],
});

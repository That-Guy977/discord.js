/* eslint-disable no-case-declarations */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process, { cwd } from 'node:process';
import {
	findPackage,
	getMembers,
	type ApiItemJSON,
	type ApiClassJSON,
	type ApiFunctionJSON,
	type ApiInterfaceJSON,
	type ApiTypeAliasJSON,
	type ApiVariableJSON,
	type ApiEnumJSON,
} from '@discordjs/api-extractor-utils';
import { createApiModel } from '@discordjs/scripts';
import { ApiFunction, ApiItemKind, type ApiPackage } from '@microsoft/api-extractor-model';
import Head from 'next/head';
import { useRouter } from 'next/router';
import type { GetStaticPaths, GetStaticProps } from 'next/types';
import { MDXRemote } from 'next-mdx-remote';
import { serialize } from 'next-mdx-remote/serialize';
import { useEffect, useMemo, useState } from 'react';
import rehypeIgnore from 'rehype-ignore';
import rehypePrettyCode, { type Options } from 'rehype-pretty-code';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { getHighlighter } from 'shiki';
import shikiLangJavascript from 'shiki/languages/javascript.tmLanguage.json';
import shikiLangTypescript from 'shiki/languages/typescript.tmLanguage.json';
import shikiThemeDarkPlus from 'shiki/themes/dark-plus.json';
import shikiThemeLightPlus from 'shiki/themes/light-plus.json';
import { SidebarLayout, type SidebarLayoutProps } from '~/components/SidebarLayout';
import { Class } from '~/components/model/Class';
import { Enum } from '~/components/model/Enum';
import { Function } from '~/components/model/Function';
import { Interface } from '~/components/model/Interface';
import { TypeAlias } from '~/components/model/TypeAlias';
import { Variable } from '~/components/model/Variable';
import { CmdKProvider } from '~/contexts/cmdK';
import { MemberProvider } from '~/contexts/member';
import { DESCRIPTION, PACKAGES } from '~/util/constants';
import { findMember, findMemberByKey } from '~/util/model.server';
import { tryResolveDescription } from '~/util/summary';

export const getStaticPaths: GetStaticPaths = async () => {
	const pkgs = (
		await Promise.all(
			PACKAGES.map(async (packageName) => {
				try {
					let data: any[] = [];
					let versions: string[] = [];
					if (process.env.NEXT_PUBLIC_LOCAL_DEV) {
						const res = await readFile(
							join(cwd(), '..', '..', 'packages', packageName, 'docs', 'docs.api.json'),
							'utf8',
						);
						data = JSON.parse(res);
					} else {
						const response = await fetch(`https://docs.discordjs.dev/api/info?package=${packageName}`);
						versions = await response.json();
						versions = versions.slice(-2);

						for (const version of versions) {
							const res = await fetch(`https://docs.discordjs.dev/docs/${packageName}/${version}.api.json`);
							data = [...data, await res.json()];
						}
					}

					if (Array.isArray(data)) {
						const models = data.map((innerData) => createApiModel(innerData));
						const pkgs = models.map((model) => findPackage(model, packageName)) as ApiPackage[];

						return [
							...versions.map((version) => ({ params: { slug: ['packages', packageName, version] } })),
							...pkgs.flatMap((pkg, idx) =>
								getMembers(pkg, versions[idx] ?? 'main').map((member) => {
									if (member.kind === ApiItemKind.Function && member.overloadIndex && member.overloadIndex > 1) {
										return {
											params: {
												slug: [
													'packages',
													packageName,
													versions[idx] ?? 'main',
													`${member.name}:${member.overloadIndex}:${member.kind}`,
												],
											},
										};
									}

									return {
										params: {
											slug: ['packages', packageName, versions[idx] ?? 'main', `${member.name}:${member.kind}`],
										},
									};
								}),
							),
						];
					}

					const model = createApiModel(data);
					const pkg = findPackage(model, packageName)!;

					return [
						{ params: { slug: ['packages', packageName, 'main'] } },
						...getMembers(pkg, 'main').map((member) => {
							if (member.kind === ApiItemKind.Function && member.overloadIndex && member.overloadIndex > 1) {
								return {
									params: {
										slug: ['packages', packageName, 'main', `${member.name}:${member.overloadIndex}:${member.kind}`],
									},
								};
							}

							return { params: { slug: ['packages', packageName, 'main', `${member.name}:${member.kind}`] } };
						}),
					];
				} catch {
					return { params: { slug: [] } };
				}
			}),
		)
	).flat();

	return {
		paths: pkgs,
		fallback: true,
	};
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
	const [path, packageName = 'builders', branchName = 'main', member] = params!.slug as string[];

	if (path !== 'packages' || !PACKAGES.includes(packageName)) {
		return {
			notFound: true,
		};
	}

	const [memberName, overloadIndex] = member?.split(':') ?? [];

	try {
		const readme = await readFile(join(cwd(), '..', '..', 'packages', packageName, 'README.md'), 'utf8');

		const mdxSource = await serialize(readme, {
			mdxOptions: {
				remarkPlugins: [remarkGfm],
				remarkRehypeOptions: { allowDangerousHtml: true },
				rehypePlugins: [
					rehypeRaw,
					rehypeIgnore,
					rehypeSlug,
					[
						rehypePrettyCode,
						{
							theme: {
								dark: shikiThemeDarkPlus,
								light: shikiThemeLightPlus,
							},
							getHighlighter: async (options?: Partial<Options>) =>
								getHighlighter({
									...options,
									langs: [
										// @ts-expect-error: Working as intended
										{ id: 'javascript', aliases: ['js'], scopeName: 'source.js', grammar: shikiLangJavascript },
										// @ts-expect-error: Working as intended
										{ id: 'typescript', aliases: ['ts'], scopeName: 'source.ts', grammar: shikiLangTypescript },
									],
								}),
						},
					],
				],
				format: 'md',
			},
		});

		let data;
		if (process.env.NEXT_PUBLIC_LOCAL_DEV) {
			const res = await readFile(join(cwd(), '..', '..', 'packages', packageName, 'docs', 'docs.api.json'), 'utf8');
			data = JSON.parse(res);
		} else {
			const res = await fetch(`https://docs.discordjs.dev/docs/${packageName}/${branchName}.api.json`);
			data = await res.json();
		}

		const model = createApiModel(data);
		const pkg = findPackage(model, packageName);

		// eslint-disable-next-line prefer-const
		let { containerKey, name } = findMember(model, packageName, memberName, branchName) ?? {};
		if (name && overloadIndex && !Number.isNaN(Number.parseInt(overloadIndex, 10))) {
			containerKey = ApiFunction.getContainerKey(name, Number.parseInt(overloadIndex, 10));
		}

		const members = pkg
			? getMembers(pkg, branchName).filter((item) => item.overloadIndex === null || item.overloadIndex <= 1)
			: [];
		const member =
			memberName && containerKey ? findMemberByKey(model, packageName, containerKey, branchName) ?? null : null;
		const description = member ? tryResolveDescription(member) ?? DESCRIPTION : DESCRIPTION;

		return {
			props: {
				packageName,
				branchName,
				data: {
					members,
					member,
					description,
					source: mdxSource,
				},
			},
			revalidate: 3_600,
		};
	} catch (error_) {
		const error = error_ as Error;
		console.error(error);

		return {
			props: {
				error: error.message,
			},
			revalidate: 1,
		};
	}
};

function resolveMember(packageName?: string | undefined, member?: SidebarLayoutProps['data']['member']) {
	switch (member?.kind) {
		case 'Class': {
			const typedMember = member as ApiClassJSON;
			return `?pkg=${packageName}&kind=${typedMember.kind}&name=${typedMember.name}&methods=${typedMember.methods.length}&props=${typedMember.properties.length}`;
		}

		case 'Function': {
			const typedMember = member as ApiFunctionJSON;
			return `?pkg=${packageName}&kind=${typedMember.kind}&name=${typedMember.name}`;
		}

		case 'Interface': {
			const typedMember = member as ApiInterfaceJSON;
			return `?pkg=${packageName}&kind=${typedMember.kind}&name=${typedMember.name}&methods=${typedMember.methods.length}&props=${typedMember.properties.length}`;
		}

		case 'TypeAlias': {
			const typedMember = member as ApiTypeAliasJSON;
			return `?pkg=${packageName}&kind=${typedMember.kind}&name=${typedMember.name}`;
		}

		case 'Variable': {
			const typedMember = member as ApiVariableJSON;
			return `?pkg=${packageName}&kind=${typedMember.kind}&name=${typedMember.name}`;
		}

		case 'Enum': {
			const typedMember = member as ApiEnumJSON;
			return `?pkg=${packageName}&kind=${typedMember.kind}&name=${typedMember.name}&members=${typedMember.members.length}`;
		}

		default: {
			return `?pkg=${packageName}&kind=${member?.kind}&name=${member?.name}`;
		}
	}
}

function member(props?: ApiItemJSON | undefined) {
	switch (props?.kind) {
		case 'Class':
			return <Class data={props as ApiClassJSON} />;
		case 'Function':
			return <Function data={props as ApiFunctionJSON} key={props.containerKey} />;
		case 'Interface':
			return <Interface data={props as ApiInterfaceJSON} />;
		case 'TypeAlias':
			return <TypeAlias data={props as ApiTypeAliasJSON} />;
		case 'Variable':
			return <Variable data={props as ApiVariableJSON} />;
		case 'Enum':
			return <Enum data={props as ApiEnumJSON} />;
		default:
			return <div>Cannot render that item type</div>;
	}
}

export default function SlugPage(props: SidebarLayoutProps & { error?: string }) {
	const router = useRouter();
	const [asPathWithoutQueryAndAnchor, setAsPathWithoutQueryAndAnchor] = useState('');

	const name = useMemo(
		() => `discord.js${props.data?.member?.name ? ` | ${props.data.member.name}` : ''}`,
		[props.data?.member?.name],
	);
	const ogTitle = useMemo(
		() => `${props.packageName ?? 'discord.js'}${props.data?.member?.name ? ` | ${props.data.member.name}` : ''}`,
		[props.packageName, props.data?.member?.name],
	);
	const ogImage = useMemo(
		() => resolveMember(props.packageName, props.data?.member),
		[props.packageName, props.data?.member],
	);

	useEffect(() => {
		setAsPathWithoutQueryAndAnchor(router.asPath.split('?')[0]?.split('#')[0] ?? '');
	}, [router.asPath]);

	if (router.isFallback) {
		return null;
	}

	// Just in case
	// return <iframe src="https://discord.js.org" style={{ border: 0, height: '100%', width: '100%' }}></iframe>;

	return props.error ? (
		<div className="flex h-full max-h-full w-full max-w-full flex-row">{props.error}</div>
	) : (
		<CmdKProvider>
			<MemberProvider member={props.data?.member}>
				<SidebarLayout {...props} asPath={asPathWithoutQueryAndAnchor}>
					{props.data?.member ? (
						<>
							<Head>
								<title key="title">{name}</title>
								<meta content={props.data.description} key="description" name="description" />
								<meta content={ogTitle} key="og_title" property="og:title" />
								<meta content={props.data.description} key="og_description" property="og:description" />
								<meta content={`https://discordjs.dev/api/og_model${ogImage}`} key="og_image" property="og:image" />
							</Head>
							{member(props.data.member)}
						</>
					) : props.data?.source ? (
						<div className="prose max-w-none">
							<MDXRemote {...props.data.source} />
						</div>
					) : null}
				</SidebarLayout>
			</MemberProvider>
		</CmdKProvider>
	);
}

export const config = {
	unstable_includeFiles: [`../../packages/{brokers,builders,collection,proxy,rest,util,voice,ws}/README.md`],
};

<?php

declare(strict_types=1);

// Build-time only. Parse public source as text; never require DiscordPHP or run.php.
// Kept compatible with DiscordPHP's supported PHP >=8.1.2.
use phpDocumentor\Reflection\File\LocalFile;
use phpDocumentor\Reflection\Php\ProjectFactory;

require __DIR__.'/vendor/autoload.php';

function cleanText(string $text, int $max = 8000): string
{
    if (preg_match('//u', $text) !== 1) {
        throw new RuntimeException('Documentation input is not valid UTF-8.');
    }
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text);
    if (strlen($text) <= $max) {
        return $text;
    }
    $text = substr($text, 0, $max - 3);
    while (preg_match('//u', $text) !== 1) {
        $text = substr($text, 0, -1);
    }
    return $text.'...';
}

function documentation($element): array
{
    $doc = $element->getDocBlock();
    if ($doc === null) {
        return ['summary' => '', 'documentation' => ''];
    }
    $lines = [(string) $doc->getSummary(), (string) $doc->getDescription()];
    foreach ($doc->getTags() as $tag) {
        $lines[] = '@'.$tag->getName().' '.(string) $tag;
    }
    return [
        'summary' => cleanText((string) $doc->getSummary(), 1200),
        'documentation' => cleanText(trim(implode("\n", $lines))),
    ];
}

function nameOf($element): string
{
    return ltrim((string) $element->getFqsen(), '\\');
}

function signatureOf($method): string
{
    $args = [];
    foreach ($method->getArguments() as $arg) {
        $args[] = (string) $arg->getType().' '.($arg->isByReference() ? '&' : '')
            .($arg->isVariadic() ? '...' : '').'$'.$arg->getName()
            .($arg->getDefault() !== null ? ' = '.$arg->getDefault() : '');
    }
    return cleanText(($method->isStatic() ? 'static ' : '')
        .rtrim(nameOf($method), '()').'('.implode(', ', $args).'): '.(string) $method->getReturnType(), 4000);
}

function generateIndex(string $source, array $lock): array
{
    $source = rtrim(str_replace('\\', '/', realpath($source) ?: ''), '/');
    if (! is_dir($source.'/src/Discord')) {
        throw new RuntimeException('Expected a DiscordPHP checkout with src/Discord.');
    }
    $paths = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source.'/src/Discord', FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isLink()) {
            throw new RuntimeException('Symlinks are not allowed in index input.');
        }
        if ($file->isFile() && $file->getExtension() === 'php') {
            $paths[] = str_replace('\\', '/', $file->getPathname());
        }
    }
    sort($paths, SORT_STRING);
    $project = ProjectFactory::createInstance()->create('DiscordPHP', array_map(static function ($path) {
        return new LocalFile($path);
    }, $paths));
    $classes = [];
    $methods = [];
    $hashes = [];
    foreach ($paths as $path) {
        $hashes[substr($path, strlen($source) + 1)] = hash('sha256', str_replace(["\r\n", "\r"], "\n", file_get_contents($path)));
    }
    foreach ($project->getFiles() as $file) {
        $relative = substr(str_replace('\\', '/', $file->getPath()), strlen($source) + 1);
        foreach (['class' => $file->getClasses(), 'interface' => $file->getInterfaces(), 'trait' => $file->getTraits()] as $kind => $elements) {
            foreach ($elements as $element) {
                $name = nameOf($element);
                $key = strtolower($name);
                $record = [
                    'name' => $name,
                    'kind' => $kind,
                    'source' => $relative,
                    'line' => $element->getLocation()->getLineNumber(),
                    'extends' => [],
                    'interfaces' => [],
                    'traits' => [],
                    'methods' => [],
                    'properties' => [],
                ] + documentation($element);
                if ($kind === 'class') {
                    if ($element->getParent() !== null) {
                        $record['extends'][] = ltrim((string) $element->getParent(), '\\');
                    }
                    $record['interfaces'] = array_map(static function ($value) { return ltrim((string) $value, '\\'); }, array_values($element->getInterfaces()));
                } elseif ($kind === 'interface') {
                    $record['extends'] = array_map(static function ($value) { return ltrim((string) $value, '\\'); }, array_values($element->getParents()));
                }
                if (method_exists($element, 'getUsedTraits')) {
                    $record['traits'] = array_map(static function ($value) { return ltrim((string) $value, '\\'); }, array_values($element->getUsedTraits()));
                }
                foreach ($element->getMethods() as $method) {
                    if ((string) $method->getVisibility() !== 'public') {
                        continue;
                    }
                    $methodName = rtrim(nameOf($method), '()');
                    $record['methods'][] = $methodName;
                    $methods[strtolower($methodName)] = [
                        'name' => $methodName,
                        'class' => $name,
                        'signature' => signatureOf($method),
                        'source' => $relative,
                        'line' => $method->getLocation()->getLineNumber(),
                    ] + documentation($method);
                }
                // PHPDoc magic properties are the canonical Part surface.
                if ($element->getDocBlock() !== null) {
                    foreach ($element->getDocBlock()->getTags() as $tag) {
                        if (in_array($tag->getName(), ['property', 'property-read', 'property-write'], true)) {
                            $record['properties'][] = cleanText('@'.$tag->getName().' '.(string) $tag, 1000);
                        }
                    }
                }
                if (method_exists($element, 'getProperties')) {
                    foreach ($element->getProperties() as $property) {
                        if ((string) $property->getVisibility() === 'public') {
                            $record['properties'][] = cleanText((string) $property->getType().' $'.$property->getName(), 1000);
                        }
                    }
                }
                sort($record['methods'], SORT_STRING);
                $classes[$key] = $record;
            }
        }
    }
    ksort($classes, SORT_STRING);
    ksort($methods, SORT_STRING);
    $docs = [];
    $docPaths = [$source.'/README.md'];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source.'/guide', FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isLink()) {
            throw new RuntimeException('Symlinks are not allowed in guide input.');
        }
        if ($file->isFile() && $file->getExtension() === 'rst') {
            $docPaths[] = str_replace('\\', '/', $file->getPathname());
        }
    }
    sort($docPaths, SORT_STRING);
    foreach ($docPaths as $path) {
        $relative = substr($path, strlen($source) + 1);
        $raw = file_get_contents($path);
        $hashes[$relative] = hash('sha256', str_replace(["\r\n", "\r"], "\n", $raw));
        $text = cleanText(str_replace("\r\n", "\n", $raw), 1000000);
        $chunks = [];
        while ($text !== '') {
            $chunk = substr($text, 0, 4000);
            while (preg_match('//u', $chunk) !== 1) {
                $chunk = substr($chunk, 0, -1);
            }
            if ($chunk === '') {
                throw new RuntimeException('Guide chunking made no progress.');
            }
            $chunks[] = $chunk;
            $text = substr($text, strlen($chunk));
        }
        $docs[$relative] = ['path' => $relative, 'chunks' => $chunks];
    }
    ksort($docs, SORT_STRING);
    ksort($hashes, SORT_STRING);
    return [
        'schemaVersion' => 1,
        'provenance' => $lock + [
            'generator' => 'phpDocumentor/reflection (tools/composer.lock)',
            'hashNormalization' => 'UTF-8 text with CRLF/CR normalized to LF',
            'scope' => 'Declared classes/interfaces/traits, public methods and public/PHPDoc properties; README and guide RST. Inherited members require following extends/traits. Aliases, constants and free functions are not indexed.',
            'inputSha256' => hash('sha256', json_encode($hashes, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
        ],
        'files' => $hashes,
        'classes' => (object) $classes,
        'methods' => (object) $methods,
        'docs' => (object) $docs,
    ];
}

if (realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    if ($argc !== 3) {
        fwrite(STDERR, "Usage: php tools/generate.php <verified-source-checkout> <output.json>\n");
        exit(1);
    }
    $lock = json_decode(file_get_contents(dirname(__DIR__).'/source-lock.json'), true, 512, JSON_THROW_ON_ERROR);
    $index = generateIndex($argv[1], $lock);
    file_put_contents($argv[2], json_encode($index, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n");
}

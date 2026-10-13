"""Bounded public GitHub release metadata fallback when the API is rate limited."""
from _helix_html_parser import HTMLParser
import re
import ssl
import urllib.parse
import urllib.request


REPO = 'lonewolf0622/HelixSR'
ROOT = f'https://github.com/{REPO}'
LATEST = ROOT + '/releases/latest'
FSR4_REPO = 'zgauthier2000/fsr4-shader-performance-overrides'
FSR4_ROOT = f'https://github.com/{FSR4_REPO}'
FSR4_RELEASES = FSR4_ROOT + '/releases'
FSR4_ASSET_NAME = 'fsr4.1.1-igpu-cyboman.zip'
FSR4_VERSION = '4.1.1'
OPTISCALER_NIGHTLY_REPO = 'optiscaler/OptiScaler-nightly'
OPTISCALER_NIGHTLY_ROOT = f'https://github.com/{OPTISCALER_NIGHTLY_REPO}'
OPTISCALER_NIGHTLY_RELEASES = OPTISCALER_NIGHTLY_ROOT + '/releases'
MAX_HTML_BYTES = 2 << 20
MAX_RELEASE_BYTES = 512 << 20
VERSION = re.compile(r'v?(\d+)\.(\d+)\.(\d+)\Z')
FSR4_TAG = re.compile(r'dll-(\d{4}-\d{2}-\d{2}(?:\.\d+)?)\Z')
OPTISCALER_NIGHTLY_TAG = re.compile(r'nightly-(\d{8})(?:-[A-Za-z0-9._-]+)?\Z')
OPTISCALER_NIGHTLY_ASSET = re.compile(r'OptiScaler_v([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9._-]+)?)_(\d{8})\.7z\Z')
DIGEST = re.compile(r'sha256:([a-fA-F0-9]{64})\Z')


def _parts(url):
    parts = urllib.parse.urlsplit(url)
    if (parts.scheme != 'https' or parts.username or parts.password or parts.port is not None
            or not parts.hostname or parts.fragment or parts.netloc.lower() != parts.hostname):
        raise ValueError('Unexpected upstream release URL')
    return parts


def _tag_page(url):
    parts = _parts(url)
    prefix = f'/{REPO}/releases/tag/'
    return (parts.hostname == 'github.com' and not parts.query
            and parts.path.startswith(prefix)
            and bool(VERSION.fullmatch(parts.path[len(prefix):])))


def _fsr4_tag_page(url):
    parts = _parts(url)
    prefix = f'/{FSR4_REPO}/releases/tag/'
    return (parts.hostname == 'github.com' and not parts.query
            and parts.path.startswith(prefix)
            and bool(FSR4_TAG.fullmatch(parts.path[len(prefix):])))


def _optiscaler_nightly_tag_page(url):
    parts = _parts(url)
    prefix = f'/{OPTISCALER_NIGHTLY_REPO}/releases/tag/'
    return (parts.hostname == 'github.com' and not parts.query
            and parts.path.startswith(prefix)
            and bool(OPTISCALER_NIGHTLY_TAG.fullmatch(parts.path[len(prefix):])))


def _expanded(url, expected):
    parts = _parts(url)
    return parts.hostname == 'github.com' and not parts.query and parts.path == expected


def _asset_target(url, expected):
    parts = _parts(url)
    if parts.hostname == 'github.com':
        return not parts.query and parts.path == urllib.parse.urlsplit(expected).path
    return parts.hostname == 'release-assets.githubusercontent.com' and parts.path.startswith('/')


class _Redirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed):
        self.allowed = allowed
        self.hops = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops += 1
        if self.hops > 3 or not self.allowed(newurl):
            raise ValueError('Unexpected upstream release redirect')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if req.get_method() == 'HEAD':
            # urllib's default redirect_request silently changes HEAD to GET.
            # Keep asset metadata checks header-only across GitHub's CDN hop.
            redirected.method = 'HEAD'
        return redirected


def _open(url, *, method, context, allowed):
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=context), _Redirect(allowed))
    response = opener.open(urllib.request.Request(
        url, headers={'User-Agent': 'HelixSR-Decky/0.1', 'Accept': 'text/html'},
        method=method), timeout=20)
    if not allowed(response.geturl()):
        response.close()
        raise ValueError('Unexpected upstream release destination')
    return response


class _AssetRows(HTMLParser):
    def __init__(self, href):
        super().__init__(convert_charrefs=True)
        self.href = href
        self.depth = 0
        self.links = []
        self.digests = []
        self.matches = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == 'li':
            if self.depth:
                self.depth += 1
            elif 'Box-row' in data.get('class', '').split():
                self.depth = 1
                self.links = []
                self.digests = []
        elif self.depth and tag == 'a':
            self.links.append(data.get('href'))
        elif self.depth and tag == 'clipboard-copy':
            self.digests.append(data.get('value'))

    def handle_endtag(self, tag):
        if tag != 'li' or not self.depth:
            return
        self.depth -= 1
        if not self.depth and self.href in self.links:
            if self.links.count(self.href) != 1 or len(self.digests) != 1:
                raise ValueError('Ambiguous official release asset row')
            digest = self.digests[0]
            if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
                raise ValueError('Official asset row lacks a SHA256 digest')
            self.matches.append(DIGEST.fullmatch(digest).group(1).lower())

    def digest(self):
        if self.depth or len(self.matches) != 1:
            raise ValueError('Official release asset or digest is missing or duplicated')
        return self.matches[0]


def web_latest_release(context=None):
    """Read the official latest tag, exact asset digest, and exact HEAD byte size."""
    context = context if context is not None else ssl.create_default_context()
    with _open(LATEST, method='GET', context=context,
               allowed=lambda url: url == LATEST or _tag_page(url)) as response:
        page = response.geturl()
        if not _tag_page(page):
            raise ValueError('Latest release did not resolve to a stable tag')
        # Read only a byte to complete this request. The redirect is the authority.
        response.read(1)
    tag = page.rsplit('/', 1)[1]
    version = tag.removeprefix('v')
    asset_href = f'/{REPO}/releases/download/{tag}/HelixSR-{version}.zip'
    asset = 'https://github.com' + asset_href
    expanded_path = f'/{REPO}/releases/expanded_assets/{tag}'
    expanded = 'https://github.com' + expanded_path
    with _open(expanded, method='GET', context=context,
               allowed=lambda url: _expanded(url, expanded_path)) as response:
        raw = response.read(MAX_HTML_BYTES + 1)
        if len(raw) > MAX_HTML_BYTES:
            raise ValueError('Upstream release assets page is too large')
    parser = _AssetRows(asset_href)
    parser.feed(raw.decode('utf-8'))
    parser.close()
    digest = parser.digest()
    with _open(asset, method='HEAD', context=context,
               allowed=lambda url: _asset_target(url, asset)) as response:
        raw_size = response.headers.get('Content-Length')
        if not isinstance(raw_size, str) or not re.fullmatch(r'[0-9]+', raw_size):
            raise ValueError('Official asset lacks exact Content-Length')
        size = int(raw_size)
        if not 0 < size <= MAX_RELEASE_BYTES:
            raise ValueError('Official asset size is outside the allowed range')
    return dict(version=version, url=asset, sha256=digest, size=size, page=page)


def web_latest_fsr4_release(context=None):
    """Read the latest dll-* FSR 4 tag, exact asset digest, and exact HEAD byte size."""
    context = context if context is not None else ssl.create_default_context()
    with _open(FSR4_RELEASES, method='GET', context=context,
               allowed=lambda url: url == FSR4_RELEASES) as response:
        raw_index = response.read(MAX_HTML_BYTES + 1)
        if len(raw_index) > MAX_HTML_BYTES:
            raise ValueError('Upstream FSR 4 releases page is too large')
    match = re.search(rf'/{re.escape(FSR4_REPO)}/releases/tag/(dll-\d{{4}}-\d{{2}}-\d{{2}}(?:\.\d+)?)',
                      raw_index.decode('utf-8', errors='replace'))
    if not match:
        raise ValueError('Latest FSR 4 dll release tag was not found')
    tag = match.group(1)
    page = f'{FSR4_ROOT}/releases/tag/{tag}'
    if not _fsr4_tag_page(page):
        raise ValueError('Latest FSR 4 release did not resolve to a valid dll tag')
    asset_href = f'/{FSR4_REPO}/releases/download/{tag}/{FSR4_ASSET_NAME}'
    asset = 'https://github.com' + asset_href
    expanded_path = f'/{FSR4_REPO}/releases/expanded_assets/{tag}'
    expanded = 'https://github.com' + expanded_path
    with _open(expanded, method='GET', context=context,
               allowed=lambda url: _expanded(url, expanded_path)) as response:
        raw = response.read(MAX_HTML_BYTES + 1)
        if len(raw) > MAX_HTML_BYTES:
            raise ValueError('Upstream FSR 4 release assets page is too large')
    parser = _AssetRows(asset_href)
    parser.feed(raw.decode('utf-8'))
    parser.close()
    digest = parser.digest()
    with _open(asset, method='HEAD', context=context,
               allowed=lambda url: _asset_target(url, asset)) as response:
        raw_size = response.headers.get('Content-Length')
        if not isinstance(raw_size, str) or not re.fullmatch(r'[0-9]+', raw_size):
            raise ValueError('Official FSR 4 asset lacks exact Content-Length')
        size = int(raw_size)
        if not 0 < size <= MAX_RELEASE_BYTES:
            raise ValueError('Official FSR 4 asset size is outside the allowed range')
    return dict(version=FSR4_VERSION, tag=tag, url=asset, sha256=digest, size=size, page=page)


def web_latest_optiscaler_nightly_release(context=None):
    """Read the latest nightly-* OptiScaler tag, exact .7z asset digest, and exact HEAD byte size."""
    context = context if context is not None else ssl.create_default_context()
    with _open(OPTISCALER_NIGHTLY_RELEASES, method='GET', context=context,
               allowed=lambda url: url == OPTISCALER_NIGHTLY_RELEASES) as response:
        raw_index = response.read(MAX_HTML_BYTES + 1)
        if len(raw_index) > MAX_HTML_BYTES:
            raise ValueError('Upstream OptiScaler Nightly releases page is too large')
    match = re.search(rf'/{re.escape(OPTISCALER_NIGHTLY_REPO)}/releases/tag/(nightly-\d{{8}}(?:-[A-Za-z0-9._-]+)?)',
                      raw_index.decode('utf-8', errors='replace'))
    if not match:
        raise ValueError('Latest OptiScaler Nightly release tag was not found')
    tag = match.group(1)
    page = f'{OPTISCALER_NIGHTLY_ROOT}/releases/tag/{tag}'
    if not _optiscaler_nightly_tag_page(page):
        raise ValueError('Latest OptiScaler Nightly release did not resolve to a valid nightly tag')
    expanded_path = f'/{OPTISCALER_NIGHTLY_REPO}/releases/expanded_assets/{tag}'
    expanded = 'https://github.com' + expanded_path
    with _open(expanded, method='GET', context=context,
               allowed=lambda url: _expanded(url, expanded_path)) as response:
        raw = response.read(MAX_HTML_BYTES + 1)
        if len(raw) > MAX_HTML_BYTES:
            raise ValueError('Upstream OptiScaler Nightly release assets page is too large')
    expanded_html = raw.decode('utf-8', errors='replace')
    asset_match = re.search(
        rf'/{re.escape(OPTISCALER_NIGHTLY_REPO)}/releases/download/{re.escape(tag)}/'
        r'(OptiScaler_v([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9._-]+)?)_(\d{8})\.7z)',
        expanded_html)
    if not asset_match:
        raise ValueError('Official OptiScaler Nightly .7z asset was not found')
    asset_name = asset_match.group(1)
    nightly_version = f'{asset_match.group(2)}+{asset_match.group(3)}'
    asset_href = f'/{OPTISCALER_NIGHTLY_REPO}/releases/download/{tag}/{asset_name}'
    asset = 'https://github.com' + asset_href
    parser = _AssetRows(asset_href)
    parser.feed(expanded_html)
    parser.close()
    digest = parser.digest()
    with _open(asset, method='HEAD', context=context,
               allowed=lambda url: _asset_target(url, asset)) as response:
        raw_size = response.headers.get('Content-Length')
        if not isinstance(raw_size, str) or not re.fullmatch(r'[0-9]+', raw_size):
            raise ValueError('Official OptiScaler Nightly asset lacks exact Content-Length')
        size = int(raw_size)
        if not 0 < size <= MAX_RELEASE_BYTES:
            raise ValueError('Official OptiScaler Nightly asset size is outside the allowed range')
    return dict(version=nightly_version, tag=tag, asset_name=asset_name,
                url=asset, sha256=digest, size=size, page=page)


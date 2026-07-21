//go:build !(darwin && (amd64 || arm64)) && !(windows && amd64)

package bundled

// No binary is bundled for this platform; Extract will report nothing and the
// app falls back to a system-installed mutagen. To bundle another platform,
// drop the release files into assets/<goos>_<goarch>/ and add an embed file
// like bundled_darwin_amd64.go with the matching build tag.
var mutagenBinary []byte

var agentsArchive []byte

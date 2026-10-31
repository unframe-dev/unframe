package hostops

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

func updateHash(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
func updateReadArchive(data []byte, repository, sha string) ([]byte, error) {
	end := -1
	for i := len(data) - 22; i >= 0 && i >= len(data)-65557; i-- {
		if binary.LittleEndian.Uint32(data[i:]) == 0x06054b50 && i+22+int(binary.LittleEndian.Uint16(data[i+20:])) == len(data) {
			end = i
			break
		}
	}
	if end < 0 || binary.LittleEndian.Uint16(data[end+4:]) != 0 || binary.LittleEndian.Uint16(data[end+6:]) != 0 || binary.LittleEndian.Uint16(data[end+8:]) != 2 || binary.LittleEndian.Uint16(data[end+10:]) != 2 {
		return nil, errors.New("invalid artifact ZIP directory")
	}
	offset := uint64(binary.LittleEndian.Uint32(data[end+16:]))
	directoryEnd := offset + uint64(binary.LittleEndian.Uint32(data[end+12:]))
	names := map[string]bool{}
	for range 2 {
		if offset+46 > uint64(end) || binary.LittleEndian.Uint32(data[offset:]) != 0x02014b50 {
			return nil, errors.New("invalid artifact ZIP entry")
		}
		length := uint64(binary.LittleEndian.Uint16(data[offset+28:]))
		if offset+46+length > uint64(end) {
			return nil, errors.New("invalid artifact ZIP entry")
		}
		name := string(data[offset+46 : offset+46+length])
		size := binary.LittleEndian.Uint32(data[offset+24:])
		mode := binary.LittleEndian.Uint32(data[offset+38:]) >> 16
		limit := uint32(updateBinaryLimit)
		if name == "manifest.json" {
			limit = 16384
		}
		if (name != "runtime-host" && name != "manifest.json") || names[name] || binary.LittleEndian.Uint16(data[offset+8:])&1 != 0 || mode&0xf000 == 0xa000 || size > limit {
			return nil, errors.New("unsafe artifact ZIP entry")
		}
		names[name] = true
		offset += 46 + length + uint64(binary.LittleEndian.Uint16(data[offset+30:])) + uint64(binary.LittleEndian.Uint16(data[offset+32:]))
	}
	if offset != directoryEnd || directoryEnd != uint64(end) {
		return nil, errors.New("invalid artifact ZIP layout")
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) != 2 {
		return nil, errors.New("invalid artifact ZIP")
	}
	var manifest struct {
		SchemaVersion int    `json:"schemaVersion"`
		Repository    string `json:"repository"`
		SHA           string `json:"sha"`
		Platform      string `json:"platform"`
		Arch          string `json:"arch"`
		SHA256        string `json:"sha256"`
	}
	var host []byte
	for _, file := range archive.File {
		limit := int64(updateBinaryLimit)
		if file.Name == "manifest.json" {
			limit = 16384
		}
		if !file.Mode().IsRegular() || file.UncompressedSize64 > uint64(limit) {
			return nil, errors.New("unsafe artifact ZIP entry")
		}
		entry, openErr := file.Open()
		if openErr != nil {
			return nil, errors.New("invalid artifact ZIP entry")
		}
		contents, readErr := io.ReadAll(io.LimitReader(entry, limit+1))
		closeErr := entry.Close()
		if readErr != nil || closeErr != nil || int64(len(contents)) > limit {
			return nil, errors.New("invalid artifact ZIP content")
		}
		if file.Name == "manifest.json" {
			if json.Unmarshal(contents, &manifest) != nil {
				return nil, errors.New("artifact manifest is invalid")
			}
		} else {
			host = contents
		}
	}
	if manifest.SchemaVersion != 1 || manifest.Repository != repository || manifest.SHA != sha || manifest.Platform != "darwin" || manifest.Arch != "arm64" || manifest.SHA256 != updateHash(host) {
		return nil, errors.New("artifact manifest mismatch")
	}
	return host, nil
}

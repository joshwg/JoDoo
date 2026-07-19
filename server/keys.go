package main

import (
	"crypto/rand"
	"math/big"
)

// shareKeyAlphabet matches the spec: lowercase alphanumeric characters only.
const shareKeyAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

const shareKeyLength = 20

// generateShareKey returns a random 20-character lowercase alphanumeric
// string, suitable for sharing out-of-band (e.g. read aloud or texted).
func generateShareKey() (string, error) {
	buf := make([]byte, shareKeyLength)
	max := big.NewInt(int64(len(shareKeyAlphabet)))
	for i := range buf {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		buf[i] = shareKeyAlphabet[n.Int64()]
	}
	return string(buf), nil
}

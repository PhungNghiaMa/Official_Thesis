package model

import "sync/atomic"

type ProgressWriter struct {
	Written    *int64
	Total      int64
	ReportFunc func(percent int)
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n := len(p)
	// atomically add to shared counter
	newWritten := atomic.AddInt64(pw.Written, int64(n))
	percent := int(float64(newWritten) / float64(pw.Total) * 100)
	if pw.ReportFunc != nil {
		pw.ReportFunc(percent)
	}
	return n, nil
}
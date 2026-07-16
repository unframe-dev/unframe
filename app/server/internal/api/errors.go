package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

type validationDetail struct {
	Message  string `json:"message" doc:"Error message"`
	Location string `json:"location,omitempty" doc:"Request value location"`
	Value    any    `json:"value,omitempty" doc:"Rejected value"`
}

type ErrorBody struct {
	Code    string `json:"code" enum:"validation_error,not_found,conflict,payload_too_large,unsupported_media_type,internal_error" doc:"Stable machine-readable error code"`
	Message string `json:"message" doc:"Human-readable error message"`
	Details any    `json:"details,omitempty" doc:"Error-specific structured details"`
}

type ErrorResponse struct {
	Body   ErrorBody `json:"error"`
	status int
}

func (response *ErrorResponse) Error() string {
	return response.Body.Message
}

func (response *ErrorResponse) GetStatus() int {
	return response.status
}

func statusError(status int, code, message string, details any) *ErrorResponse {
	return &ErrorResponse{
		Body:   ErrorBody{Code: code, Message: message, Details: details},
		status: status,
	}
}

func init() {
	huma.NewError = newErrorResponse
	huma.NewErrorWithContext = func(_ huma.Context, status int, message string, errs ...error) huma.StatusError {
		return newErrorResponse(status, message, errs...)
	}
}

func newErrorResponse(status int, message string, errs ...error) huma.StatusError {
	if status == http.StatusUnprocessableEntity {
		status = http.StatusBadRequest
	}

	code := errorCode(status)
	if status == http.StatusBadRequest {
		message = "Request validation failed"
	}
	if status >= http.StatusInternalServerError {
		message = "Internal Server Error"
	}

	response := &ErrorResponse{
		Body:   ErrorBody{Code: code, Message: message},
		status: status,
	}
	if code == "validation_error" {
		response.Body.Details = validationDetails(errs)
	}
	return response
}

func errorCode(status int) string {
	switch status {
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return "validation_error"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusRequestEntityTooLarge:
		return "payload_too_large"
	case http.StatusUnsupportedMediaType:
		return "unsupported_media_type"
	default:
		if status >= http.StatusInternalServerError || status == 0 {
			return "internal_error"
		}
		return "validation_error"
	}
}

func validationDetails(errs []error) []validationDetail {
	details := make([]validationDetail, 0, len(errs))
	for _, err := range errs {
		if err == nil {
			continue
		}
		if detailer, ok := err.(huma.ErrorDetailer); ok {
			detail := detailer.ErrorDetail()
			details = append(details, validationDetail{
				Message:  detail.Message,
				Location: detail.Location,
				Value:    detail.Value,
			})
			continue
		}
		details = append(details, validationDetail{Message: err.Error()})
	}
	return details
}

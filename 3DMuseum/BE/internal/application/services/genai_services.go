package services

import (
	"context"
	applicationRepository "main/internal/application/repo"
)

type GenAIServicesStruct struct {
	GenAIRepo applicationRepository.GenAIRepo
}

func NewGenAIServices(GenAIRepo applicationRepository.GenAIRepo) *GenAIServicesStruct{
	return &GenAIServicesStruct{GenAIRepo: GenAIRepo}
}

type GenAIServices interface {
	GenerateAnswer(ctx context.Context , WebpCID string , prompt string , imageBytes []byte, mimeType string) (string, error)
}

func (genAIStruct *GenAIServicesStruct) GenerateAnswer (ctx context.Context , WebpCID string , prompt string , imageBytes []byte , mimeType string)(string,error){
	result , err := genAIStruct.GenAIRepo.GenerateAnswer(ctx  , WebpCID , prompt , imageBytes , mimeType)
	return result , err
}


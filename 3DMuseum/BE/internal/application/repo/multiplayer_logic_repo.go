package applicationRepository
import (
	"github.com/gin-gonic/gin"
)

type MultiPlayerRepository struct {
	HandleJoin func(ctx *gin.Context)
}
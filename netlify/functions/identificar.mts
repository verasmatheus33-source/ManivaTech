import Anthropic from '@anthropic-ai/sdk'
import { ACERVO } from '../../src/acervo.js'

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
type TipoImagem = (typeof TIPOS_ACEITOS)[number]

// Limite do conteúdo em base64 (~4,5 MB de imagem), abaixo do limite de payload das funções.
const TAMANHO_MAXIMO_BASE64 = 6_000_000

const erro = (mensagem: string, status: number) => Response.json({ erro: mensagem }, { status })

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return erro('Use o método POST para enviar a imagem.', 405)
  }

  let corpo: { imagem?: unknown; tipo?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return erro('Corpo da requisição inválido. Envie um JSON com a imagem em base64.', 400)
  }

  const imagem = typeof corpo.imagem === 'string' ? corpo.imagem.replace(/^data:[^;]+;base64,/, '') : ''
  const tipo = corpo.tipo as TipoImagem
  if (!imagem) return erro('Nenhuma imagem foi enviada.', 400)
  if (!TIPOS_ACEITOS.includes(tipo)) return erro('Formato de imagem não suportado. Use JPG, PNG ou WebP.', 415)
  if (imagem.length > TAMANHO_MAXIMO_BASE64) return erro('A imagem é muito grande. Envie uma foto menor.', 413)

  const listaAcervo = ACERVO.map((p) => `- ${p.nome} (${p.cientifico})`).join('\n')

  const anthropic = new Anthropic()
  let resposta
  try {
    resposta = await anthropic.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      system:
        'Você é um botânico especialista em flora amazônica e plantas medicinais tradicionais de Manaus. ' +
        'Identifique a planta da foto de forma honesta: se a imagem não mostrar uma planta, ou se não for possível ' +
        'identificá-la com segurança, diga isso e use confiança baixa. Responda sempre em português do Brasil.\n\n' +
        `Espécies do acervo regional ManivaTech:\n${listaAcervo}`,
      tools: [
        {
          name: 'registrar_identificacao',
          description: 'Registra o resultado da identificação da planta na imagem.',
          input_schema: {
            type: 'object',
            properties: {
              e_planta: { type: 'boolean', description: 'A imagem mostra uma planta (ou parte dela)?' },
              nome_popular: { type: 'string', description: 'Nome popular mais usado no Brasil. Vazio se não identificada.' },
              nome_cientifico: { type: 'string', description: 'Nome científico. Vazio se não identificada.' },
              confianca: { type: 'number', description: 'Confiança da identificação, de 0 a 100.' },
              especie_do_acervo: {
                type: 'string',
                enum: [...ACERVO.map((p) => p.nome), 'nenhuma'],
                description: 'Espécie do acervo correspondente à planta, ou "nenhuma".',
              },
              observacao: { type: 'string', description: 'Comentário curto (até 2 frases) sobre a identificação.' },
            },
            required: ['e_planta', 'nome_popular', 'nome_cientifico', 'confianca', 'especie_do_acervo', 'observacao'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'registrar_identificacao' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: tipo, data: imagem } },
            { type: 'text', text: 'Identifique a planta desta foto.' },
          ],
        },
      ],
    })
  } catch (e) {
    console.error('Falha ao consultar o modelo de IA:', e)
    return erro('Não foi possível analisar a imagem agora. Tente novamente em instantes.', 502)
  }

  const bloco = resposta.content.find((c) => c.type === 'tool_use')
  if (!bloco || bloco.type !== 'tool_use') {
    return erro('A análise não retornou um resultado válido. Tente outra foto.', 502)
  }

  const r = bloco.input as {
    e_planta: boolean
    nome_popular: string
    nome_cientifico: string
    confianca: number
    especie_do_acervo: string
    observacao: string
  }
  const doAcervo = ACERVO.find((p) => p.nome === r.especie_do_acervo) ?? null

  return Response.json({
    planta: Boolean(r.e_planta),
    nome: doAcervo?.nome ?? r.nome_popular ?? '',
    cientifico: doAcervo?.cientifico ?? r.nome_cientifico ?? '',
    confianca: Math.max(0, Math.min(100, Number(r.confianca) || 0)),
    noAcervo: Boolean(doAcervo),
    categoria: doAcervo?.categoria ?? null,
    contraindicacao: doAcervo?.contraindicacao ?? null,
    observacao: r.observacao ?? '',
  })
}

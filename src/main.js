import './style.css'
import {
  AuthError,
  MissingIdentityError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  signup,
} from '@netlify/identity'
import { ACERVO } from './acervo.js'

const UBS = [
  { nome: 'UBS Dr. Josephina de Mello', lat: -3.1301, lon: -60.0235, endereco: 'Rua Leovegildo Coelho, Centro' },
  { nome: 'UBS Morro da Liberdade', lat: -3.1425, lon: -60.012, endereco: 'Rua 2 de Maio, Morro da Liberdade' },
  { nome: 'UBS Nilo Pessôa', lat: -3.125, lon: -60.005, endereco: 'Av. Leonardo Malcher, Centro' },
]

const $ = (id) => document.getElementById(id)
const escapar = (texto) =>
  String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const normalizar = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function aviso(mensagem) {
  const toast = $('toast')
  toast.textContent = mensagem
  toast.classList.remove('hidden')
  clearTimeout(aviso.timer)
  aviso.timer = setTimeout(() => toast.classList.add('hidden'), 5000)
}

// ---------- Navegação entre módulos ----------
let mapaIniciado = false
let mapa
let marcadorUsuario

function mostrarModulo(modulo) {
  for (const m of ['busca', 'foto', 'mapa']) $(`modulo-${m}`).classList.toggle('hidden', m !== modulo)
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('underline', btn.dataset.modulo === modulo)
  })
  if (modulo === 'mapa') {
    setTimeout(() => {
      if (mapaIniciado) mapa.invalidateSize()
      else {
        iniciarMapa()
        mapaIniciado = true
      }
    }, 150)
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => mostrarModulo(btn.dataset.modulo))
})

// ---------- Módulo 1: Busca e ficha técnica ----------
function cartaoPlanta(p) {
  return `
    <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
      <div>
        <span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-semibold">${escapar(p.categoria)}</span>
        <h3 class="text-lg font-bold text-slate-900 mt-3">${escapar(p.nome)}</h3>
        <p class="text-xs italic text-slate-500 mb-3">${escapar(p.cientifico)}</p>
        <p class="text-sm text-slate-600">${escapar(p.descricao)}</p>
      </div>
      <div class="mt-4 pt-4 border-t border-slate-100">
        <span class="text-xs font-bold text-amber-700 block">⚠️ Contraindicação: ${escapar(p.contraindicacao)}</span>
      </div>
    </div>`
}

function buscar() {
  const termo = normalizar($('inputBusca').value)
  const resultado = termo
    ? ACERVO.filter((p) => normalizar([p.nome, p.cientifico, p.categoria, p.descricao].join(' ')).includes(termo))
    : ACERVO
  $('resultadoBusca').innerHTML = resultado.length
    ? resultado.map(cartaoPlanta).join('')
    : `<div class="md:col-span-3 bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-600">
         Nenhuma espécie encontrada para "<strong>${escapar($('inputBusca').value)}</strong>". Tente outro nome popular ou científico.
       </div>`
  $('contadorBusca').textContent = termo
    ? `${resultado.length} espécie(s) encontrada(s) no acervo.`
    : `Exibindo todas as ${ACERVO.length} espécies do acervo.`
}

$('formBusca').addEventListener('submit', (e) => {
  e.preventDefault()
  buscar()
})
$('inputBusca').addEventListener('input', buscar)
buscar()
mostrarModulo('busca')

// ---------- Módulo 2: Identificação por foto ----------
const LADO_MAXIMO = 1280

// Reduz a foto no navegador antes do envio, mantendo o payload pequeno.
async function prepararImagem(arquivo) {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.85)
}

$('fileInput').addEventListener('change', (e) => {
  const arquivo = e.target.files?.[0]
  if (!arquivo) return
  if (arquivo.size > 10 * 1024 * 1024) {
    aviso('A imagem excede o limite de 10MB.')
    e.target.value = ''
    return
  }
  $('fileLabel').textContent = 'Arquivo selecionado: ' + arquivo.name
  const preview = $('filePreview')
  if (preview.src) URL.revokeObjectURL(preview.src)
  preview.src = URL.createObjectURL(arquivo)
  preview.classList.remove('hidden')
  $('fileIcon').classList.add('hidden')
  $('resultadoIA').classList.add('hidden')
})

$('btnAnalisar').addEventListener('click', async () => {
  const arquivo = $('fileInput').files?.[0]
  if (!arquivo) {
    aviso('Selecione uma imagem da planta antes de iniciar a análise.')
    return
  }
  const botao = $('btnAnalisar')
  botao.disabled = true
  botao.textContent = 'Analisando imagem...'
  try {
    let imagem
    try {
      imagem = await prepararImagem(arquivo)
    } catch {
      throw new Error('Não foi possível ler esta imagem. Tente outro arquivo JPG ou PNG.')
    }

    const resposta = await fetch('/.netlify/functions/identificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagem, tipo: 'image/jpeg' }),
    })
    const dados = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível analisar a imagem agora.')

    if (!dados.planta || !dados.nome) {
      $('iaEspecie').textContent = 'Nenhuma planta identificada'
    } else {
      $('iaEspecie').textContent = dados.cientifico ? `${dados.nome} (${dados.cientifico})` : dados.nome
    }
    $('iaConfianca').textContent = `${Number(dados.confianca).toFixed(0)}%`
    $('iaContra').textContent = dados.contraindicacao ? `⚠️ Contraindicação: ${dados.contraindicacao}` : ''
    $('iaObs').textContent = [
      dados.observacao,
      dados.noAcervo
        ? 'Espécie encontrada no acervo regional de Manaus.'
        : 'Esta espécie não consta no acervo regional do ManivaTech. Procure uma UBS antes de qualquer uso.',
    ]
      .filter(Boolean)
      .join(' ')
    $('resultadoIA').classList.remove('hidden')
  } catch (erro) {
    aviso(erro.message || 'Ocorreu um erro inesperado. Tente novamente.')
  } finally {
    botao.disabled = false
    botao.textContent = 'Analisar Imagem'
  }
})

// ---------- Módulo 3: Geolocalização de UBS ----------
$('listaUbs').innerHTML = UBS.map(
  (u, i) => `
    <button data-ubs="${i}" class="text-left p-4 border border-slate-200 rounded-lg bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50 transition">
      <h4 class="font-bold text-slate-900 text-sm">${escapar(u.nome)}</h4>
      <p class="text-xs text-slate-600 mt-1">Endereço: ${escapar(u.endereco)}</p>
      <span class="inline-block mt-2 text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-medium">Atendimento SUS • Manaus</span>
    </button>`,
).join('')

const marcadores = []

function iniciarMapa() {
  mapa = L.map('map').setView([-3.119, -60.0217], 13)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(mapa)
  UBS.forEach((u) => {
    const marcador = L.marker([u.lat, u.lon])
      .addTo(mapa)
      .bindPopup(`<b>${escapar(u.nome)}</b><br>${escapar(u.endereco)}<br><span style="color:green;">Disponível para orientações</span>`)
    marcadores.push(marcador)
  })
}

$('listaUbs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ubs]')
  if (!btn || !mapa) return
  const u = UBS[btn.dataset.ubs]
  mapa.setView([u.lat, u.lon], 16)
  marcadores[btn.dataset.ubs].openPopup()
})

function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = (g) => (g * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

$('btnLocalizacao').addEventListener('click', () => {
  if (!navigator.geolocation) {
    aviso('Seu navegador não suporta geolocalização.')
    return
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude, longitude } }) => {
      if (!mapa) return
      const maisProxima = UBS.map((u) => ({ ...u, km: distanciaKm(latitude, longitude, u.lat, u.lon) })).sort(
        (a, b) => a.km - b.km,
      )[0]
      mapa.setView([latitude, longitude], 15)
      if (marcadorUsuario) marcadorUsuario.remove()
      marcadorUsuario = L.circleMarker([latitude, longitude], {
        radius: 9,
        color: '#047857',
        fillColor: '#10b981',
        fillOpacity: 0.9,
      })
        .addTo(mapa)
        .bindPopup(`<b>Você está aqui</b><br>UBS mais próxima: ${escapar(maisProxima.nome)} (${maisProxima.km.toFixed(1)} km)`)
        .openPopup()
    },
    () => aviso('Não foi possível obter sua localização atual. Verifique as permissões do navegador.'),
  )
})

// ---------- Autenticação (Netlify Identity) ----------
function abrirModal() {
  $('modalAuth').classList.remove('hidden')
  $('modalAuth').classList.add('flex')
}

function fecharModal() {
  $('modalAuth').classList.add('hidden')
  $('modalAuth').classList.remove('flex')
  mensagemAuth('')
}

function mensagemAuth(texto, tipo = 'erro') {
  const el = $('authMsg')
  el.textContent = texto
  el.className = `${texto ? '' : 'hidden '}mb-4 text-sm rounded-lg px-3 py-2 ${
    tipo === 'erro' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
  }`
}

const ABA_ATIVA = 'flex-1 py-3 text-sm font-bold text-emerald-800 border-b-2 border-emerald-700 bg-white transition'
const ABA_INATIVA = 'flex-1 py-3 text-sm font-medium text-slate-500 hover:text-slate-700 transition'

function trocarAba(aba) {
  const cadastro = aba === 'cadastro'
  $('formCadastro').classList.toggle('hidden', !cadastro)
  $('formLogin').classList.toggle('hidden', cadastro)
  $('abaCadastroBtn').className = cadastro ? ABA_ATIVA : ABA_INATIVA
  $('abaLoginBtn').className = cadastro ? ABA_INATIVA : ABA_ATIVA
  $('modalTitulo').textContent = cadastro ? 'Cadastrar no ManivaTech' : 'Acessar Conta ManivaTech'
  mensagemAuth('')
}

function traduzirErro(erro) {
  if (erro instanceof MissingIdentityError) return 'O serviço de autenticação não está disponível no momento.'
  if (erro instanceof AuthError) {
    if (erro.status === 401 || erro.status === 400) {
      return /confirm/i.test(erro.message)
        ? 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'
        : 'E-mail ou senha inválidos.'
    }
    if (erro.status === 403) return 'Novos cadastros não estão permitidos no momento.'
    if (erro.status === 422) return 'Dados inválidos. Verifique o e-mail e use uma senha com pelo menos 6 caracteres.'
    return erro.message
  }
  return 'Ocorreu um erro inesperado. Tente novamente.'
}

function atualizarUsuario(usuario) {
  $('btnAuth').classList.toggle('hidden', !!usuario)
  $('usuarioLogado').classList.toggle('hidden', !usuario)
  $('usuarioLogado').classList.toggle('flex', !!usuario)
  if (usuario) $('usuarioNome').textContent = usuario.name || usuario.email
}

async function comBotaoDesativado(form, acao) {
  const botao = form.querySelector('button[type="submit"]')
  botao.disabled = true
  try {
    await acao()
  } finally {
    botao.disabled = false
  }
}

$('formCadastro').addEventListener('submit', (e) => {
  e.preventDefault()
  comBotaoDesativado(e.target, async () => {
    const nome = $('cadNome').value.trim()
    try {
      const usuario = await signup($('cadEmail').value.trim(), $('cadSenha').value, { full_name: nome })
      e.target.reset()
      if (usuario.confirmedAt) {
        fecharModal()
        aviso(`Sucesso! Cadastro de ${nome} realizado no ManivaTech.`)
      } else {
        mensagemAuth(`Cadastro realizado, ${nome}! Enviamos um link de confirmação para o seu e-mail.`, 'sucesso')
      }
    } catch (erro) {
      mensagemAuth(traduzirErro(erro))
    }
  })
})

$('formLogin').addEventListener('submit', (e) => {
  e.preventDefault()
  comBotaoDesativado(e.target, async () => {
    try {
      const usuario = await login($('logEmail').value.trim(), $('logSenha').value)
      e.target.reset()
      fecharModal()
      aviso(`Bem-vindo de volta, ${usuario.name || usuario.email}!`)
    } catch (erro) {
      mensagemAuth(traduzirErro(erro))
    }
  })
})

$('btnAuth').addEventListener('click', abrirModal)
$('btnFecharModal').addEventListener('click', fecharModal)
$('modalAuth').addEventListener('click', (e) => {
  if (e.target.id === 'modalAuth') fecharModal()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharModal()
})
document.querySelectorAll('[data-aba]').forEach((btn) => {
  btn.addEventListener('click', () => trocarAba(btn.dataset.aba))
})
$('btnSair').addEventListener('click', async () => {
  try {
    await logout()
  } finally {
    atualizarUsuario(null)
    aviso('Você saiu da sua conta.')
  }
})

onAuthChange((_evento, usuario) => atualizarUsuario(usuario))

async function iniciarAuth() {
  try {
    const resultado = await handleAuthCallback()
    if (resultado?.type === 'confirmation') aviso('E-mail confirmado! Você já está conectado ao ManivaTech.')
  } catch (erro) {
    if (erro instanceof AuthError) aviso(traduzirErro(erro))
  }
  atualizarUsuario(await getUser())
}

iniciarAuth()

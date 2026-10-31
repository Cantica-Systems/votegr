// Spanish. A draft, not yet reviewed by a native speaker: the page says so in its intro.
// Election terms follow the U.S. Election Assistance Commission's Spanish glossary
// (precinto, boleta de voto en ausencia, votación anticipada). Formal "usted" throughout.
// Keys are the English text (see site/i18n.js); "#" keys are markup in index.html.
// tests/test_i18n.mjs checks every key is here and every {slot} matches the English.
// Street, place, jurisdiction and clerk names are never translated: they are how the
// signs and the ballot read.

export default {
  // ---- index.html ----
  '#title': 'VoteGR.org: herramienta anónima para saber dónde votar en el condado de Kent, Michigan',
  '#cd_label': 'Faltan para el día de las elecciones:',
  '#lede': 'Este sitio es una herramienta única de información electoral para residentes del condado de Kent, ' +
    'Michigan, que protege su privacidad: sin rastreo y sin registros. Es 100 % gratuita y de ' +
    'código abierto, y todos los datos ya se cargaron en su dispositivo al abrir esta página. ' +
    '<a href="#" id="howLink" class="how-link">¿Cómo?</a> ' +
    '<span class="lang-note">Esta traducción al español es preliminar y aún no la ha revisado ' +
    'un hablante nativo.</span>',
  '#enter_address': 'Escriba una dirección:',
  '#pin_title': 'Trazar la ruta desde un punto del mapa',
  '#start_over': 'Empezar de nuevo',
  '#parts': 'Partes de la respuesta',
  '#nav_info': 'Dónde votar',
  '#nav_dir': 'Cómo llegar',
  '#your_info': 'Su información electoral:',
  '#close': 'Cerrar',
  '#legend': 'Leyenda del mapa:',
  '#lg_precinct': 'Precinto',
  '#lg_wards': 'Distritos, o su municipio',
  '#lg_border': 'Límite de ciudad o municipio',
  '#lg_polling': 'Lugar de votación',
  '#lg_early': 'Lugar de votación anticipada',
  '#lg_dropbox': 'Buzón de boletas',
  '#lg_camera': 'Cámara lectora de placas',
  '#help_title': '¿Tiene problemas para votar?',
  '#help_body': '¿No le dejan votar, no aparece en la lista o alguien lo intimida? Llame a ' +
    'la línea no partidista de Protección Electoral (Election Protection):',
  // The coalition's Spanish-language line first, then the main one.
  '#help_line': '<a href="tel:+18888398682">888-VE-Y-VOTA <span>(888-839-8682)</span></a>' +
    '<br><span class="help-alt">o <a href="tel:+18666878683">866-OUR-VOTE ' +
    '<span>(866-687-8683), también por mensaje de texto</span></a></span>',
  '#help_mi': '<a href="https://866ourvote.org/state/michigan/" target="_blank" ' +
    'rel="noopener">Más ayuda para votantes de Michigan</a>',
  '#color_scheme': 'Esquema de colores',
  '#light': 'Claro',
  '#match_system': 'Igual que el sistema',
  '#dark': 'Oscuro',
  '#about': 'Acerca de',
  '#about_body': `
      <p class="modal-tagline">Privacidad desde el diseño</p>

      <h3>Qué es esto</h3>
      <p class="body">Es una herramienta que calcula su precinto, su lugar de votación y cómo
        llegar, todo dentro de su navegador.</p>

      <h3>Cómo funciona</h3>
      <p class="body">Reunimos datos públicos del estado, la ciudad y el condado, y creamos un
        sistema de rutas para que todo funcione en su dispositivo y no en un servidor. Al abrir
        la página también se cargan los archivos de datos. Cuando usted busca, los resultados
        aparecen sin hacer ninguna solicitud a la red, así que todo lo que consulta es 100 %
        anónimo. Una vez cargada la página, puede incluso desconectarse de internet y seguir
        buscando.</p>
      <p class="body">También damos indicaciones que, si usted quiere, evitan las cámaras
        lectoras de placas conocidas. Su ubicación viene de OpenStreetMap, donde gran parte del
        mapeo de estas cámaras es obra de voluntarios de
        <a href="https://deflock.org/" target="_blank" rel="noopener">DeFlock</a>.</p>

      <h3>¿Por qué lo hicimos?</h3>
      <ol class="body why-list">
        <li>
          <h4>Saber dónde votar no debería obligarle a identificarse.</h4>
          <p>El
            <a href="https://mvic.sos.state.mi.us/" target="_blank" rel="noopener">Centro de Información para Votantes de Michigan</a>
            del estado es preciso y es la fuente oficial, pero le pide su nombre, su mes y año de
            nacimiento y su código postal antes de mostrarle su distrito y su precinto, y cada
            consulta se procesa en sus servidores. El aviso que usted acepta en ese formulario
            dice, completo (en inglés):</p>
          <blockquote lang="en">The information collected on this form is only what is needed to complete your transaction as authorized by MCL 168.509ii, MCL 168.759, MCL 168.759a, and MCL 168.764c. As a public body, MDOS is subject to the Michigan Freedom of Information Act (FOIA), MCL 15.231 et seq., and information such as a name or address may be disclosed in response to a FOIA request.</blockquote>
          <p>Es decir: la información puede entregarse a quien la solicite bajo la Ley de Libertad
            de Información (FOIA). Este sitio demuestra que nada de eso es necesario. Para
            mostrarle dónde votar no hace falta procesar su inscripción en los servidores del
            estado, y el estado no necesita saber que usted lo consultó. Su registro de votante ya
            es un registro público, que puede divulgarse bajo FOIA acepte usted o no ese aviso.
            Pero preguntar dónde votar podría crear un segundo registro: que usted, desde esta
            dirección, en este día, se buscó a sí mismo. Si ese registro puede divulgarse es otra
            cuestión. Los registros de consultas son datos, y si no hace falta reunirlos, ¿para
            qué reunirlos? Este sitio carga todo en su dispositivo, así que no existe ningún
            registro de consultas que pueda identificarle.</p>
        </li>
        <li>
          <h4>Llegar a donde vota tampoco debería obligarle a identificarse, ni siquiera por su
            vehículo.</h4>
          <p>Manejar para participar en una actividad protegida por la Constitución debería
            estar libre de vigilancia. Las cámaras lectoras de placas en semáforos y postes
            registran cada vehículo que pasa y pueden alertar a un agente en tiempo real cuando
            una placa está marcada. Nadie debería sentirse incómodo por ser rastreado camino a
            votar. Que lo detengan porque una cámara leyó su placa es poco probable para la
            mayoría, pero es una posibilidad real, incluidos los falsos positivos. Por eso las
            indicaciones de esta página le llevan a su lugar de votación, a un lugar de votación
            anticipada o a un buzón de boletas por una ruta que rodea las cámaras que este
            proyecto conoce, y cuando todas las rutas pasan por alguna, se lo dice y toma la que
            pasa por menos.</p>
        </li>
      </ol>

      <h3>Licencia y alojamiento propio</h3>
      <p class="body">El código es abierto y de dominio público, bajo la
        <a href="https://github.com/Cantica-Systems/votegr/blob/main/UNLICENSE" target="_blank" rel="noopener">Unlicense</a>.
        Tómelo de
        <a href="https://github.com/Cantica-Systems/votegr" target="_blank" rel="noopener">GitHub</a>,
        cópielo, alójelo o modifíquelo, con o sin mención, incluso si es la oficina de un
        secretario municipal que prefiere tener el suyo. Dos componentes lo acompañan y conservan
        sus propias licencias libres: la biblioteca de mapas
        <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>, bajo BSD
        2-Clause, y la tipografía Hanken Grotesk, bajo la SIL Open Font License.</p>
      <p class="body">Los datos son otra cosa, porque no nos corresponde licenciarlos y no todos
        tienen las mismas condiciones. Los límites de los precintos, las calles, las direcciones,
        los lugares de votación y los buzones de boletas son registros públicos del estado de
        Michigan, del condado de Kent y de los secretarios municipales, y se presentan aquí tal
        como se publicaron. La ubicación de las cámaras, las restricciones de giro que siguen las
        rutas, y el agua y los parques del mapa vienen de OpenStreetMap y tienen la licencia
        <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>,
        que pide a quien los reutilice dar crédito a OpenStreetMap y compartir en las mismas
        condiciones lo que construya. Cada archivo de datos del repositorio indica de dónde viene
        y bajo qué condiciones.</p>

      <p class="modal-credit">Un proyecto de código abierto de
        <a href="https://cantica.dev" target="_blank" rel="noopener">Cantica Systems</a>.</p>
`,

  // ---- Elections, as elections.json names them ----
  'Primary Election': 'elecciones primarias',
  'General Election': 'elecciones generales',

  // ---- app.js: places and the answer ----
  'Roads: Kent County (REGIS)': 'Calles: condado de Kent (REGIS)',
  'Outside Kent County': 'Fuera del condado de Kent',
  'Ward {n}': 'Distrito {n}',
  'Precinct {n}': 'Precinto {n}',
  'Precincts {list}': 'Precintos {list}',
  'your area': 'su zona',
  'Returning an absentee ballot in {where}': 'Cómo devolver una boleta de voto en ausencia en {where}',
  'Ballot drop boxes in {where}': 'Buzones de boletas en {where}',
  'Early voting sites in {where}': 'Lugares de votación anticipada en {where}',
  'Not open yet: these sites take ballots from {date}.': 'Aún no abren: estos lugares reciben boletas desde el {date}.',
  'Location:': 'Ubicación:',
  'Get directions here': 'Cómo llegar aquí',
  'Inside the building, so there is no address to route to.': 'Está dentro del edificio, así que no hay una dirección hacia la cual trazar la ruta.',
  'Source:': 'Fuente:',
  'read {date}': 'consultada el {date}',
  'archived copy': 'copia archivada',
  'Ballot drop box': 'Buzón de boletas',
  'No election scheduled': 'No hay elecciones programadas',
  '{from} to {to}': 'Del {from} al {to}',
  'Absentee voting upcoming': 'Pronto empieza el voto en ausencia',
  'Absentee ballots are mailed from {date}. They can be returned from then until the polls close on election day.':
    'Las boletas de voto en ausencia se envían por correo a partir del {date}. Pueden devolverse desde entonces hasta que cierren las urnas el día de las elecciones.',
  'Absentee voting closed': 'El voto en ausencia terminó',
  'Absentee voting open': 'Voto en ausencia abierto',
  "A returned ballot has to be in the clerk's hands by the time the polls close on election day.":
    'La boleta devuelta debe estar en manos del secretario municipal antes de que cierren las urnas el día de las elecciones.',
  'Custom location selected': 'Lugar elegido por usted',
  'Directions': 'Cómo llegar',
  'this jurisdiction': 'esta jurisdicción',
  'No ballot drop box is published for {where}. An absentee ballot has to be returned to your own clerk, so the clerk’s office is where it goes, during office hours.':
    'No hay un buzón de boletas publicado para {where}. La boleta de voto en ausencia debe devolverse a su propio secretario municipal, así que se entrega en su oficina, en horario de oficina.',
  'Drop box': 'Buzón',
  'No polling place on file.': 'No hay un lugar de votación registrado.',
  'Polling place': 'Lugar de votación',
  'Early voting site': 'Lugar de votación anticipada',
  'Absentee ballot drop box': 'Buzón para boletas de voto en ausencia',
  'Where to return an absentee ballot': 'Dónde devolver una boleta de voto en ausencia',
  'Ballot drop box nearest to you': 'Buzón de boletas más cercano',
  'Show all drop box locations': 'Ver todos los buzones',
  'Early voting site nearest to you': 'Lugar de votación anticipada más cercano',
  'Early voting sites': 'Lugares de votación anticipada',
  'Early voting is not tied to your precinct. Any Grand Rapids voter may use any of these {n} sites.':
    'La votación anticipada no depende de su precinto. Cualquier votante de Grand Rapids puede usar cualquiera de estos {n} lugares.',
  'No site published yet.': 'Aún no se ha publicado ningún lugar.',
  'Show all locations': 'Ver todos los lugares',
  'Open now': 'Abierto ahora',
  'Today': 'Hoy',
  'today': 'hoy',
  'Election day polling place': 'Lugar de votación el día de las elecciones',
  'Show it on the map': 'Verlo en el mapa',
  'Precinct {n} votes with precinct {host} this election, because {why}.':
    'En estas elecciones, el precinto {n} vota junto con el precinto {host}, por este motivo: {why}.',
  'Precinct {n} votes with precinct {host} this election.':
    'En estas elecciones, el precinto {n} vota junto con el precinto {host}.',
  'No polling place on file for precinct {n}.': 'No hay un lugar de votación registrado para el precinto {n}.',
  'Election day': 'Día de las elecciones',
  'Hours:': 'Horario:',
  '{open} to {close}': 'de {open} a {close}',
  'Where to register in person': 'Dónde inscribirse en persona',
  'call {phone}': 'llame al {phone}',
  'Register here in person, and you can usually vote at the same visit. The same goes if you have moved since you registered. Bring something with your name and current address on it, on paper or on your phone':
    'Inscríbase aquí en persona y, por lo general, podrá votar en la misma visita. Lo mismo aplica si se mudó después de inscribirse. Traiga algo con su nombre y su dirección actual, en papel o en su teléfono',
  'what counts': 'qué documentos sirven, en inglés',
  'Through {date}': 'Hasta el {date}',
  'Today, until {time}': 'Hoy, hasta las {time}',
  'Not registered yet?': '¿Aún no está inscrito para votar?',
  'Where you vote': 'Dónde vota',
  'Ward': 'Distrito',
  'Precinct': 'Precinto',
  'Directions here': 'Cómo llegar aquí',
  'Get directions here instead': 'Mejor ir aquí',
  'Grand Rapids City Clerk': 'secretario municipal de Grand Rapids',
  '{jurisdiction} clerk': 'secretario municipal de {jurisdiction}',
  'the {clerk}': 'el {clerk}',
  'your clerk': 'su secretario municipal',
  'Your clerk': 'Su secretario municipal',
  'Michigan Voter Information Center': 'Centro de Información para Votantes de Michigan',
  'Not an official government tool.': 'No es una herramienta oficial del gobierno.',
  'Your voting location is based on the address where you registered to vote, not what you enter here. If you are not sure the entered address is the same, double-check with {whom} or the {mvic}.':
    'Su lugar de votación depende de la dirección con la que se inscribió para votar, no de la que escriba aquí. Si no está seguro de que sean la misma, confírmelo con {whom} o con el {mvic}.',
  'This address sits on a precinct line and could be in {list}.':
    'Esta dirección está en el límite entre precintos y podría pertenecer a {list}.',
  'This exact number is not in the address list, so the precinct was taken from its neighbors and checked against the precinct boundary.':
    'Este número exacto no está en la lista de direcciones, así que el precinto se dedujo de las direcciones vecinas y se comprobó con el límite del precinto.',
  'This address is close to a precinct boundary, so the answer is less certain.':
    'Esta dirección está cerca del límite de un precinto, así que la respuesta es menos segura.',
  'Read as {street}. Other streets also match what you typed.':
    'Se interpretó como {street}. Otras calles también coinciden con lo que escribió.',
  'Obey all traffic signs and laws.': 'Respete todas las señales y leyes de tránsito.',
  'Early voting closed': 'La votación anticipada terminó',
  'Ended {date}': 'Terminó el {date}',
  'Early voting has ended. Its sites no longer take ballots, so they are not offered for directions.':
    'La votación anticipada terminó. Sus lugares ya no reciben boletas, así que no se ofrecen indicaciones para llegar.',
  'Early voting dates': 'Fechas de la votación anticipada',
  'Early voting has not opened yet. Its sites take ballots from {date}, and you can plan directions to any of them now.':
    'La votación anticipada aún no empieza. Sus lugares reciben boletas desde el {date}, y ya puede planear cómo llegar a cualquiera de ellos.',
  'Early voting open': 'Votación anticipada abierta',
  '{jurisdiction} Clerk’s Office': 'Oficina del secretario municipal de {jurisdiction}',
  'Your Clerk’s Office': 'Oficina de su secretario municipal',
  'Grand Rapids City Clerk’s Office': 'Oficina del secretario municipal de Grand Rapids',
  'Open during office hours': 'Abierto en horario de oficina',
  'Open 24/7': 'Abierto las 24 horas, todos los días',
  'Open hours: {hours}': 'Horario (en inglés): {hours}',
  'Early voting site, opens {date}': 'Lugar de votación anticipada, abre el {date}',
  'Clerk’s office, to register': 'Oficina del secretario municipal, para inscribirse',
  'Early voting': 'Votación anticipada',
  'Register': 'Inscribirse',

  // ---- Lookup and errors ----
  'Map layers': 'Capas del mapa',
  'Precinct boundaries': 'Límites de los precintos',
  'Precinct numbers': 'Números de precinto',
  'Ward and precinct colors': 'Colores de distritos y precintos',
  'Voting locations': 'Lugares para votar',
  'License plate cameras': 'Cámaras lectoras de placas',
  'Camera data': 'Datos de las cámaras',
  '1 reported camera in Kent County, from OpenStreetMap as of the last time this page was published. Volunteer-mapped and certainly incomplete, so treat it as a floor rather than a full count.':
    '1 cámara reportada en el condado de Kent, según OpenStreetMap la última vez que se publicó esta página. La mapean voluntarios y sin duda falta información, así que tómelo como un mínimo y no como el total.',
  '{n} reported cameras in Kent County, from OpenStreetMap as of the last time this page was published. Volunteer-mapped and certainly incomplete, so treat it as a floor rather than a full count.':
    '{n} cámaras reportadas en el condado de Kent, según OpenStreetMap la última vez que se publicó esta página. Las mapean voluntarios y sin duda faltan algunas, así que tome la cifra como un mínimo y no como el total.',
  'Loading Kent County…': 'Cargando el condado de Kent…',
  'Loading the county’s roads and addresses. This happens once.':
    'Cargando las calles y direcciones del condado. Esto pasa una sola vez.',
  'Loading the county’s roads, {done} of {total} jurisdictions. This happens once.':
    'Cargando las calles del condado: {done} de {total} jurisdicciones. Esto pasa una sola vez.',
  'Could not load the map data files. If you are hosting this yourself, check that the data folder sits next to this page.':
    'No se pudieron cargar los archivos de datos del mapa. Si usted aloja este sitio, revise que la carpeta de datos esté junto a esta página.',
  ' and in ': ' y en ',
  '{address} is an address in {places}. Pick yours from the list as you type.':
    '{address} es una dirección en {places}. Elija la suya de la lista mientras escribe.',
  'Could not resolve {address}.': 'No se pudo encontrar {address}.',
  'another jurisdiction': 'otra jurisdicción',
  '{list} or {last}': '{list} o {last}',
  ' or ': ' o ',
  ' and ': ' y ',
  'That street is in {where}, but the address list this tool uses has no address on it, so it cannot be looked up by address. Use the pin button beside the search box and drop the pin where you live, and it will find your precinct from there.':
    'Esa calle está en {where}, pero la lista de direcciones que usa esta herramienta no tiene ninguna dirección en ella, así que no se puede buscar por dirección. Use el botón del alfiler junto a la caja de búsqueda y póngalo donde vive; así encontrará su precinto.',
  'That address is in {where}, which this tool does not cover, so it cannot say where you vote. The Michigan Voter Information Center at mvic.sos.state.mi.us will have your polling place.':
    'Esa dirección está en {where}, que esta herramienta no cubre, así que no puede decirle dónde votar. El Centro de Información para Votantes de Michigan, en mvic.sos.state.mi.us, tiene su lugar de votación.',
  'Start with the house number, like 300 Monroe Ave NW.': 'Empiece con el número de la casa, por ejemplo: 300 Monroe Ave NW.',
  'No Kent County street matches that. Check the spelling and the direction, like 300 Monroe Ave NW. This tool covers Kent County, Michigan; an address in Ottawa, Allegan, Barry, Ionia, Montcalm or Newaygo County is not in it.':
    'Ninguna calle del condado de Kent coincide. Revise la ortografía y la orientación, por ejemplo: 300 Monroe Ave NW. Esta herramienta cubre el condado de Kent, Michigan; las direcciones de los condados de Ottawa, Allegan, Barry, Ionia, Montcalm o Newaygo no están incluidas.',
  'Tap the map where you want to start from. Esc cancels.':
    'Toque el mapa donde quiere empezar. Esc cancela.',
  'Tap anywhere in Kent County to start from that spot.':
    'Toque cualquier punto del condado de Kent para empezar desde ahí.',
  'That spot is outside Kent County, or not in any precinct we have. This tool covers Kent County, Michigan. Try dropping the pin on a street, or type the address instead.':
    'Ese punto está fuera del condado de Kent o no pertenece a ningún precinto que tengamos. Esta herramienta cubre el condado de Kent, Michigan. Ponga el alfiler sobre una calle, o mejor escriba la dirección.',
  'Routing from your dropped pin. Type an address to switch back.':
    'La ruta empieza en su alfiler. Escriba una dirección para volver.',
  'estimated': 'aproximada',
  'did you mean': '¿quiso decir?',
  'nearest on this street': 'la más cercana en esta calle',

  // ---- Countdown ----
  'Election Day is In:': 'Faltan para el día de las elecciones:',
  'Days': 'Días',
  'Hours': 'Horas',
  'Minutes': 'Minutos',
  'Seconds': 'Segundos',
  'Polls Open In:': 'Las urnas abren en:',
  'Polls Close In:': 'Las urnas cierran en:',
  'Polls Have Closed:': 'Las urnas cerraron:',
  'Election Day:': 'Día de las elecciones:',
  'Polls open at {time} today for the {election}.': 'Hoy las urnas abren a las {time} para las {election}.',
  'Polls are open until {time} today for the {election}.': 'Hoy las urnas están abiertas hasta las {time} para las {election}.',
  'Everyone in line when the polls closed must be allowed to vote.':
    'Toda persona que estaba en la fila al cerrar las urnas tiene derecho a votar.',
  'The {election} is today, {date}.': 'Las {election} son hoy, {date}.',
  '1 day until the {election} on {date}.': 'Falta 1 día para las {election}, el {date}.',
  '{n} days until the {election} on {date}.': 'Faltan {n} días para las {election}, el {date}.',

  // ---- Directions ----
  'Found where you vote, but could not place your address on the street map, so no route is drawn.':
    'Encontramos dónde vota, pero no pudimos ubicar su dirección en el mapa de calles, así que no se traza ninguna ruta.',
  'No drivable route between your address and {place} on this road network.':
    'No hay una ruta en carro entre su dirección y {place} en esta red de calles.',
  'You’re already here': 'Ya está aquí',
  '{place} is at the address you searched, so there is nothing here to navigate. Pick another destination above for directions.':
    '{place} está en la dirección que buscó, así que no hay ruta que seguir. Elija arriba otro destino para ver cómo llegar.',
  'You are here': 'Usted está aquí',
  'Finish': 'Llegada',
  'Start': 'Salida',
  'Avoiding': 'Evitando cámaras',
  'Fastest': 'Más rápida',
  'an unnamed road': 'una calle sin nombre',
  '1 camera': '1 cámara',
  '{n} cameras': '{n} cámaras',
  'no cameras': 'ninguna cámara',
  'No cameras': 'Sin cámaras',
  'Passing {cams}': 'Pasa por {cams}',
  'Avoiding {cams}': 'Evita {cams}',
  'Traversing {cams}': 'Pasa por {cams}',
  'Going through the cameras would not get you there any faster, so only this route is offered.':
    'Pasar por las cámaras no le haría llegar más rápido, así que solo se ofrece esta ruta.',
  'This is also the way that passes the fewest cameras.':
    'Esta es también la ruta que pasa por menos cámaras.',
  'Going around them costs you nothing.': 'Rodearlas no le cuesta nada.',
  'Going around them costs an extra {extra}.': 'Rodearlas le cuesta {extra} más.',
  'Show this part of the route on the map': 'Ver esta parte de la ruta en el mapa',
  'There is no way to reach this destination without passing 1 known camera, on {streets}. This route passes the fewest it can.':
    'No hay forma de llegar a este destino sin pasar por 1 cámara conocida, en {streets}. Esta ruta pasa por las menos posibles.',
  'There is no way to reach this destination without passing {n} known cameras, on {streets}. This route passes the fewest it can.':
    'No hay forma de llegar a este destino sin pasar por {n} cámaras conocidas, en {streets}. Esta ruta pasa por las menos posibles.',
  'Arrive at your destination': 'Llegue a su destino',
  'Head {dir} on {street}': 'Siga hacia el {dir} por {street}',
  'Head {dir}': 'Siga hacia el {dir}',
  'Continue': 'Continúe',
  'Continue onto {street}': 'Continúe por {street}',
  'Bear right': 'Manténgase a la derecha',
  'Bear right onto {street}': 'Manténgase a la derecha hacia {street}',
  'Bear left': 'Manténgase a la izquierda',
  'Bear left onto {street}': 'Manténgase a la izquierda hacia {street}',
  'Turn right': 'Gire a la derecha',
  'Turn right onto {street}': 'Gire a la derecha en {street}',
  'Turn left': 'Gire a la izquierda',
  'Turn left onto {street}': 'Gire a la izquierda en {street}',
  'Sharp right': 'Gire bruscamente a la derecha',
  'Sharp right onto {street}': 'Gire bruscamente a la derecha en {street}',
  'Sharp left': 'Gire bruscamente a la izquierda',
  'Sharp left onto {street}': 'Gire bruscamente a la izquierda en {street}',
  'Make a U-turn': 'Dé vuelta en U',
  'Make a U-turn onto {street}': 'Dé vuelta en U hacia {street}',
  'north': 'norte',
  'northeast': 'noreste',
  'east': 'este',
  'southeast': 'sureste',
  'south': 'sur',
  'southwest': 'suroeste',
  'west': 'oeste',
  'northwest': 'noroeste',

  // ---- map.js: the camera popup ----
  'License plate camera': 'Cámara lectora de placas',
  'Faces': 'Orientación',
  'Made by': 'Fabricante',
  'Model': 'Modelo',
  'Brand': 'Marca',
  'Camera type': 'Tipo de cámara',
  'Mounted on': 'Montada en',
  'Operated by': 'Operada por',
  'Operator type': 'Tipo de operador',
  'Watches': 'Vigila',
  'Zone': 'Zona',
  'Power': 'Alimentación',
  'Height': 'Altura',
  'Level': 'Nivel',
  'Support': 'Soporte',
  'Note': 'Nota',
  'Description': 'Descripción',
  'Reference': 'Referencia',
  'Surveyed': 'Inspeccionada',
  'Last checked': 'Última revisión',
  'Installed': 'Instalada',
  'First mapped': 'Mapeada por primera vez',
  'Last edited': 'Última edición',
  'yesterday': 'ayer',
  '{n} days ago': 'hace {n} días',
  '1 month ago': 'hace 1 mes',
  '{n} months ago': 'hace {n} meses',
  '{n} years ago': 'hace {n} años',
  'No details recorded in OpenStreetMap.': 'OpenStreetMap no tiene más detalles.',
  'version {n}': 'versión {n}'
};
